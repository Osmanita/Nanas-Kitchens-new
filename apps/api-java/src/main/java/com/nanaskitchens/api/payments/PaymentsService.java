package com.nanaskitchens.api.payments;

import com.nanaskitchens.api.inventory.InventoryService;
import com.nanaskitchens.api.inventory.PortionsChanged;
import com.nanaskitchens.api.notifications.NotificationsService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/**
 * Story 3.4 — settles pending orders from payment-provider events. Both transitions are
 * idempotent (guarded by the current status under FOR UPDATE), so webhook replays are
 * no-ops, matching the delivery webhook's contract.
 */
@Service
public class PaymentsService {

    private final JdbcClient db;
    private final InventoryService inventory;
    private final ApplicationEventPublisher eventPublisher;
    private final JsonMapper jsonMapper;
    private final NotificationsService notifications;

    public PaymentsService(
            JdbcClient db,
            InventoryService inventory,
            ApplicationEventPublisher eventPublisher,
            JsonMapper jsonMapper,
            NotificationsService notifications) {
        this.db = db;
        this.inventory = inventory;
        this.eventPublisher = eventPublisher;
        this.jsonMapper = jsonMapper;
        this.notifications = notifications;
    }

    private record OrderRow(String id, String status, String buyerId) {
    }

    /** payment_intent.succeeded → pending order becomes confirmed (enters the seller flow). */
    @Transactional
    public Map<String, Object> markPaid(String paymentIntentId) {
        OrderRow order = lockByIntent(paymentIntentId);
        if (order == null) {
            return Map.of("applied", false, "reason", "ORDER_NOT_FOUND");
        }
        if (!"pending".equals(order.status())) {
            // Replay, or the order was cancelled while the payment sheet was open — the money
            // is captured with no live order; surface it in the audit trail for manual refund.
            String reason = "confirmed".equals(order.status()) ? "REPLAY" : "ORPHANED_PAYMENT";
            audit("webhook:payments", order.id(), "payment_orphan_check",
                    Map.of("paymentIntentId", paymentIntentId, "status", order.status(), "reason", reason));
            return Map.of("applied", false, "reason", reason);
        }
        db.sql("UPDATE \"Order\" SET status = 'confirmed' WHERE id = :id").param("id", order.id()).update();
        audit("webhook:payments", order.id(), "payment_succeeded", Map.of("paymentIntentId", paymentIntentId));
        // FR22 — the seller only hears about a stripe-mode order once it's actually paid.
        record SellerRow(String sellerId, String fulfillment, String readySlot) {
        }
        SellerRow seller = db.sql("""
                SELECT k."sellerId", o.fulfillment, to_char(o."readySlot", 'HH24:MI') AS ready_slot
                FROM "Order" o JOIN "Kitchen" k ON k.id = o."kitchenId"
                WHERE o.id = :id
                """)
                .param("id", order.id())
                .query((rs, n) -> new SellerRow(
                        rs.getString("sellerId"), rs.getString("fulfillment"), rs.getString("ready_slot")))
                .single();
        notifications.notify(seller.sellerId(), "order_placed", "New order",
                "A " + seller.fulfillment() + " order came in, ready time " + seller.readySlot() + ".",
                Map.of("orderId", order.id()));
        return Map.of("applied", true, "orderId", order.id(), "status", "confirmed");
    }

    /**
     * payment_intent.payment_failed / canceled, or checkout abandonment (sweeper) —
     * the compensating restore of Story 3.3 AC3: portions go back in the same transaction
     * that cancels the order.
     */
    @Transactional
    public Map<String, Object> releaseFailedPayment(String paymentIntentId, String reason) {
        OrderRow order = lockByIntent(paymentIntentId);
        if (order == null || !"pending".equals(order.status())) {
            return Map.of("applied", false);
        }
        record ItemQty(String menuItemId, int qty) {
        }
        List<ItemQty> items = db.sql("SELECT \"menuItemId\", qty FROM \"OrderItem\" WHERE \"orderId\" = :id")
                .param("id", order.id())
                .query((rs, n) -> new ItemQty(rs.getString("menuItemId"), rs.getInt("qty")))
                .list();
        for (ItemQty item : items) {
            inventory.restore(item.menuItemId(), item.qty());
        }
        db.sql("UPDATE \"Order\" SET status = 'cancelled' WHERE id = :id").param("id", order.id()).update();
        audit("webhook:payments", order.id(), "payment_failed",
                Map.of("paymentIntentId", paymentIntentId, "reason", reason));
        // FR22 — redirect-based payers may never come back to the order page; tell them.
        notifications.notify(order.buyerId(), "payment_failed", "Payment didn't complete",
                "Your order was released because the payment didn't go through — you were not charged.",
                Map.of("orderId", order.id()));
        eventPublisher.publishEvent(new PortionsChanged(items.stream().map(ItemQty::menuItemId).toList()));
        return Map.of("applied", true, "orderId", order.id(), "status", "cancelled");
    }

    private OrderRow lockByIntent(String paymentIntentId) {
        return db.sql("SELECT id, status, \"buyerId\" FROM \"Order\" WHERE \"paymentIntentId\" = :pi FOR UPDATE")
                .param("pi", paymentIntentId)
                .query((rs, n) -> new OrderRow(
                        rs.getString("id"), rs.getString("status"), rs.getString("buyerId")))
                .optional()
                .orElse(null);
    }

    /** Only a verified paid Checkout event can replace its session reference and settle. */
    @Transactional
    public Map<String, Object> markCheckoutPaid(String sessionId, String intentId, Long amount, String currency) {
        OrderRow order = lockByIntent(sessionId);
        if (order == null || !"pending".equals(order.status()) || intentId == null) {
            return Map.of("applied", false);
        }
        int expected = db.sql("SELECT \"totalCents\" FROM \"Order\" WHERE id = :id")
                .param("id", order.id()).query(Integer.class).single();
        if (amount == null || amount != expected || !"usd".equals(currency)) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_REQUEST, "PAYMENT_AMOUNT_MISMATCH");
        }
        db.sql("UPDATE \"Order\" SET \"paymentIntentId\" = :pi WHERE id = :id")
                .param("pi", intentId).param("id", order.id()).update();
        return markPaid(intentId);
    }

    private void audit(String actor, String orderId, String action, Map<String, Object> after) {
        db.sql("""
                INSERT INTO "AuditLog" (id, actor, entity, action, "after")
                VALUES (:id, :actor, :entity, :action, :after::jsonb)
                """)
                .param("id", UUID.randomUUID().toString())
                .param("actor", actor)
                .param("entity", "Order:" + orderId)
                .param("action", action)
                .param("after", jsonMapper.writeValueAsString(after))
                .update();
    }
}
