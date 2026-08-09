package com.nanaskitchens.api.orders;

import com.nanaskitchens.api.delivery.DeliveryService;
import com.nanaskitchens.api.delivery.GeocodingService;
import com.nanaskitchens.api.inventory.InventoryService;
import com.nanaskitchens.api.inventory.PortionsChanged;
import com.nanaskitchens.api.kitchens.AddressCrypto;
import com.nanaskitchens.api.notifications.NotificationsService;
import com.nanaskitchens.api.payments.PaymentProvider;
import com.nanaskitchens.api.kitchens.dto.MenuDayResponse;
import com.nanaskitchens.api.orders.dto.CreateOrderRequest;
import com.nanaskitchens.api.orders.dto.OrderDetailResponse;
import com.nanaskitchens.api.orders.dto.OrderSummary;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

/** Ported from apps/api/src/orders (Story 3.3 core, Stripe integration remains Story 3.4). */
@Service
public class OrdersService {

    private static final double COMMISSION_RATE = 0.15;
    private static final int DELIVERY_FEE_CENTS = 399;
    private static final double DELIVERY_RADIUS_MILES = 10;
    private static final double METERS_PER_MILE = 1609.344;
    // Cancelling releases the portions and refunds in full, so it may only run while nothing
    // has been spent on the order yet: 'pending' (the buyer's payment sheet is still open) and
    // 'confirmed' (the seller hasn't accepted). From 'accepted' on the kitchen is cooking —
    // restoring the portions would put food that no longer exists back on sale, and the buyer
    // would be refunded for it. 'declined' is excluded for the opposite reason: decline()
    // already restores and refunds, so a second pass would do both twice.
    private static final Set<String> CANCELLABLE = Set.of("pending", "confirmed");
    // Orders that ended without the buyer getting food. An idempotency replay must not hand
    // one of these back as a confirmed order (see place()).
    private static final Set<String> DEAD_STATUSES = Set.of("cancelled", "declined");

    /** Story 4.1 seller transitions: current status -> allowed next statuses. */
    private static final Map<String, Set<String>> SELLER_TRANSITIONS = Map.of(
            "confirmed", Set.of("accepted", "declined"),
            "accepted", Set.of("preparing"),
            "preparing", Set.of("ready"),
            "ready", Set.of("completed"));

    private final JdbcClient db;
    private final InventoryService inventory;
    private final AddressCrypto addressCrypto;
    private final JsonMapper jsonMapper;
    private final org.springframework.context.ApplicationEventPublisher eventPublisher;
    private final DeliveryService deliveryService;
    private final GeocodingService geocoding;
    private final PaymentProvider payments;
    private final NotificationsService notifications;

    public OrdersService(
            JdbcClient db,
            InventoryService inventory,
            AddressCrypto addressCrypto,
            JsonMapper jsonMapper,
            org.springframework.context.ApplicationEventPublisher eventPublisher,
            DeliveryService deliveryService,
            GeocodingService geocoding,
            PaymentProvider payments,
            NotificationsService notifications) {
        this.db = db;
        this.inventory = inventory;
        this.addressCrypto = addressCrypto;
        this.jsonMapper = jsonMapper;
        this.eventPublisher = eventPublisher;
        this.deliveryService = deliveryService;
        this.geocoding = geocoding;
        this.payments = payments;
        this.notifications = notifications;
    }

    /**
     * FR15 (server-side): without confirm=true no order is created — only a priced summary is
     * returned. Agent/MCP and UI all go through this same path (NFR3).
     * Anti-hallucination: every menuItemId must be on the kitchen's PUBLISHED menu for that day.
     */
    @Transactional
    public Map<String, Object> place(String buyerId, CreateOrderRequest input) {
        record MenuRow(String menuItemId, String dishName, int priceCents) {
        }
        List<MenuRow> menuRows = db.sql("""
                SELECT mi.id AS menu_item_id, d.name AS dish_name, d."priceCents"
                FROM "MenuDay" md
                JOIN "MenuItem" mi ON mi."menuDayId" = md.id
                JOIN "Dish" d ON d.id = mi."dishId"
                WHERE md.id = :menuDayId AND md."kitchenId" = :kitchenId AND md.status = 'published'
                """)
                .param("menuDayId", input.menuDayId())
                .param("kitchenId", input.kitchenId())
                .query((rs, n) -> new MenuRow(rs.getString("menu_item_id"), rs.getString("dish_name"),
                        rs.getInt("priceCents")))
                .list();
        if (menuRows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "MENU_NOT_PUBLISHED");
        }

        Map<String, MenuRow> valid = new HashMap<>();
        for (MenuRow row : menuRows) {
            valid.put(row.menuItemId(), row);
        }
        for (CreateOrderRequest.Item item : input.items()) {
            if (!valid.containsKey(item.menuItemId())) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST, "ITEM_NOT_IN_MENU:" + item.menuItemId());
            }
            if (item.qty() < 1) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "QTY_INVALID");
            }
        }

        // FR9/NFR5: delivery needs a drop-off address (validated up front so the agent can
        // ask the buyer before any inventory or payment side effects happen).
        boolean isDelivery = "delivery".equals(input.fulfillment());
        String deliveryAddress =
                input.deliveryAddress() == null || input.deliveryAddress().isBlank()
                        ? null
                        : input.deliveryAddress().trim();
        if (isDelivery && deliveryAddress == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "ADDRESS_REQUIRED: delivery orders need deliveryAddress (street, city)");
        }
        if (isDelivery) {
            checkDeliveryRadius(input.kitchenId(), deliveryAddress);
        }

        int foodSubtotalCents = input.items().stream()
                .mapToInt(it -> valid.get(it.menuItemId()).priceCents() * it.qty())
                .sum();
        int deliveryFeeCents = isDelivery ? DELIVERY_FEE_CENTS : 0;
        int courierTipCents = isDelivery ? input.courierTipCents() : 0;
        int totalCents = foodSubtotalCents + deliveryFeeCents + courierTipCents;
        int commissionCents = (int) Math.round(foodSubtotalCents * COMMISSION_RATE);

        OrderSummary summary = new OrderSummary(
                input.kitchenId(),
                input.items().stream()
                        .map(it -> new OrderSummary.Item(
                                it.menuItemId(),
                                valid.get(it.menuItemId()).dishName(),
                                it.qty(),
                                valid.get(it.menuItemId()).priceCents()))
                        .toList(),
                input.readySlot(),
                input.fulfillment(),
                isDelivery ? deliveryAddress : null,
                foodSubtotalCents,
                deliveryFeeCents,
                courierTipCents,
                totalCents);

        if (!input.confirm()) {
            return Map.of("confirmed", false, "summary", summary); // FR15: summary first, no side effects
        }

        // A fresh UUID for the idempotency key meant a double submit - two clicks, a retried
        // request - looked like a brand new order to both us and Stripe: two orders, two
        // charges, stock decremented twice. Deriving the key from the request makes the retry
        // collide with the first attempt, so Stripe returns the original PaymentIntent and the
        // UNIQUE constraint on Order.idempotencyKey refuses the second row.
        //
        // This check MUST come before the decrement below. Returning early after decrementing
        // would commit the decrement without an order attached and quietly leak portions -
        // which is exactly what happened the first time this was written.
        String idempotencyKey = idempotencyKeyFor(buyerId, input);
        Optional<String> alreadyPlaced = db
                .sql("SELECT id FROM \"Order\" WHERE \"idempotencyKey\" = :key AND \"buyerId\" = :buyerId")
                .param("key", idempotencyKey)
                .param("buyerId", buyerId)
                .query(String.class)
                .optional();
        if (alreadyPlaced.isPresent()) {
            OrderDetailResponse existing = detail(buyerId, alreadyPlaced.get());
            if ("pending".equals(existing.status())) {
                // The first attempt is still waiting on the buyer's PaymentIntent. Sending a
                // second one would double-charge, so tell the client to resume that order
                // instead of quietly starting another.
                throw new ResponseStatusException(HttpStatus.CONFLICT, "PAYMENT_IN_PROGRESS");
            }
            if (!DEAD_STATUSES.contains(existing.status())) {
                return Map.of("confirmed", true, "order", existing);
            }
            // The earlier attempt was cancelled or declined, so this is a buyer deliberately
            // re-ordering, not a duplicate submit. Replaying it would hand back a dead order
            // as "confirmed" and place nothing. Give the new order a key of its own - the
            // dead one still holds the derived key, and that column is UNIQUE.
            idempotencyKey = idempotencyKey + ":" + UUID.randomUUID();
        }

        // Atomic: decrement + order in one transaction (Story 2.3 / architecture Workflow 1).
        // The PaymentIntent is created inside the same transaction on purpose: a provider
        // failure rolls everything back, which IS the compensating restore of Story 3.3 AC3.
        String orderId = UUID.randomUUID().toString();
        for (CreateOrderRequest.Item item : input.items()) {
            inventory.decrement(item.menuItemId(), item.qty());
        }
        PaymentProvider.Intent intent = payments.createIntent(orderId, totalCents, idempotencyKey);
        // mock settles instantly → confirmed (pre-3.4 behaviour); stripe stays pending until
        // the webhook lands (detail() already withholds the pickup address while pending).
        boolean paid = "succeeded".equals(intent.status());
        db.sql("""
                INSERT INTO "Order"
                  (id, "buyerId", "kitchenId", "menuDayId", status, "readySlot", fulfillment,
                   "totalCents", "commissionCents", "deliveryFeeCents", "tipCents", "paymentIntentId",
                   "idempotencyKey", "deliveryAddressEncrypted")
                VALUES
                  (:id, :buyerId, :kitchenId, :menuDayId, :status, :readySlot, :fulfillment,
                   :totalCents, :commissionCents, :deliveryFeeCents, :tipCents, :paymentIntentId,
                   :idempotencyKey, :deliveryAddressEncrypted)
                """)
                .param("id", orderId)
                .param("buyerId", buyerId)
                .param("kitchenId", input.kitchenId())
                .param("menuDayId", input.menuDayId())
                .param("status", paid ? "confirmed" : "pending")
                .param("readySlot", parseReadySlot(input.readySlot()))
                .param("fulfillment", input.fulfillment())
                .param("totalCents", totalCents)
                .param("commissionCents", commissionCents)
                .param("deliveryFeeCents", deliveryFeeCents)
                .param("tipCents", courierTipCents)
                .param("paymentIntentId", intent.id())
                .param("idempotencyKey", idempotencyKey)
                // NFR5: the drop-off address is what the courier is dispatched to, so it has to
                // survive the request. Stored encrypted like Kitchen.addressEncrypted; encrypt()
                // dereferences its argument, so pickup orders store null rather than encrypting it.
                .param("deliveryAddressEncrypted",
                        isDelivery ? addressCrypto.encrypt(deliveryAddress) : null)
                .update();
        for (CreateOrderRequest.Item item : input.items()) {
            db.sql("""
                    INSERT INTO "OrderItem" (id, "orderId", "menuItemId", qty, "unitPriceCents")
                    VALUES (:id, :orderId, :menuItemId, :qty, :unitPriceCents)
                    """)
                    .param("id", UUID.randomUUID().toString())
                    .param("orderId", orderId)
                    .param("menuItemId", item.menuItemId())
                    .param("qty", item.qty())
                    .param("unitPriceCents", valid.get(item.menuItemId()).priceCents())
                    .update();
        }
        db.sql("""
                INSERT INTO "AuditLog" (id, actor, entity, action, "after")
                VALUES (:id, :actor, :entity, 'create', :after::jsonb)
                """)
                .param("id", UUID.randomUUID().toString())
                .param("actor", buyerId)
                .param("entity", "Order:" + orderId)
                .param("after", jsonMapper.writeValueAsString(summary))
                .update();

        // Delivered AFTER_COMMIT: SSE subscribers see the new counts only once they're durable.
        eventPublisher.publishEvent(
                new PortionsChanged(input.items().stream().map(CreateOrderRequest.Item::menuItemId).toList()));
        if (paid) {
            notifySellerNewOrder(orderId, input.kitchenId()); // FR22 — pending orders wait for markPaid
            return Map.of("confirmed", true, "order", detail(buyerId, orderId));
        }
        // Client must confirm the PaymentIntent (Stripe Elements/PaymentSheet); the
        // payment_intent.succeeded webhook then flips the order to confirmed.
        Map<String, Object> payment = new LinkedHashMap<>();
        payment.put("provider", payments.name());
        payment.put("clientSecret", intent.clientSecret());
        payment.put("publishableKey", payments.publishableKey());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("confirmed", false);
        result.put("requiresPayment", true);
        result.put("orderId", orderId);
        result.put("payment", payment);
        return result;
    }

    /**
     * Stable fingerprint of "this exact basket, from this buyer, right now". Two submissions of
     * the same order collide and are treated as one; changing anything that moves the price or
     * the fulfilment produces a different key, so an edited order still goes through.
     *
     * <p>The minute bucket is what bounds it. Double clicks and network retries land inside the
     * same minute and dedupe; a buyer who genuinely wants the same basket again a minute later
     * is not blocked, which a purely content-derived key would have made impossible. The cost
     * is a narrow seam: a double submit straddling a minute boundary still gets through.
     */
    private String idempotencyKeyFor(String buyerId, CreateOrderRequest input) {
        StringBuilder canonical = new StringBuilder()
                .append(buyerId).append('|')
                .append(input.kitchenId()).append('|')
                .append(input.menuDayId()).append('|')
                .append(input.readySlot()).append('|')
                .append(input.fulfillment()).append('|')
                .append(input.courierTipCents()).append('|')
                .append(input.deliveryAddress() == null ? "" : input.deliveryAddress().trim()).append('|')
                .append(Instant.now().truncatedTo(ChronoUnit.MINUTES)).append('|');
        input.items().stream()
                .sorted(Comparator.comparing(CreateOrderRequest.Item::menuItemId))
                .forEach(it -> canonical.append(it.menuItemId()).append('x').append(it.qty()).append(','));
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(canonical.toString().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required for order idempotency keys", e);
        }
    }

    /** FR22 — the seller learns about a (paid) order the moment it lands. */
    public void notifySellerNewOrder(String orderId, String kitchenId) {
        record Row(String sellerId, String fulfillment, String readySlot) {
        }
        Row row = db.sql("""
                SELECT k."sellerId", o.fulfillment, to_char(o."readySlot", 'HH24:MI') AS ready_slot
                FROM "Order" o JOIN "Kitchen" k ON k.id = o."kitchenId"
                WHERE o.id = :orderId AND k.id = :kitchenId
                """)
                .param("orderId", orderId)
                .param("kitchenId", kitchenId)
                .query((rs, n) -> new Row(
                        rs.getString("sellerId"), rs.getString("fulfillment"), rs.getString("ready_slot")))
                .single();
        notifications.notify(row.sellerId(), "order_placed", "New order",
                "A " + row.fulfillment() + " order came in, ready time " + row.readySlot() + ".",
                Map.of("orderId", orderId));
    }

    /**
     * FR5's 10-mile radius applies to delivery drop-offs too. The address is geocoded with
     * tiered fallbacks (dev: Nominatim) and measured against the kitchen's PostGIS point.
     * If no variant of the address resolves, the order is rejected so the buyer can give a
     * clearer address — never delivered blind.
     */
    private void checkDeliveryRadius(String kitchenId, String deliveryAddress) {
        GeocodingService.Point point = geocoding.geocode(deliveryAddress);
        if (point == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "ADDRESS_NOT_FOUND: could not locate this address on the map. Ask the buyer "
                            + "for a clearer address including the town/city name.");
        }
        // Cheap, clearer rejection before the distance math — every kitchen is US-based, so a
        // non-US drop-off would fail the radius check anyway, but with a confusing "X thousand
        // miles away" message instead of telling the buyer plainly why it can't work.
        if (point.countryCode() != null && !"us".equalsIgnoreCase(point.countryCode())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "ADDRESS_OUTSIDE_US: delivery is only available within the United States right now. "
                            + "Offer pickup, or ask for a US delivery address.");
        }
        Double meters = db.sql("""
                SELECT ST_Distance(geo, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography)
                FROM "Kitchen" WHERE id = :kitchenId AND geo IS NOT NULL
                """)
                .param("lng", point.lng())
                .param("lat", point.lat())
                .param("kitchenId", kitchenId)
                .query(Double.class)
                .optional()
                .orElse(null);
        if (meters != null && meters > DELIVERY_RADIUS_MILES * METERS_PER_MILE) {
            double miles = Math.round(meters / METERS_PER_MILE * 10) / 10.0;
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "ADDRESS_OUT_OF_RANGE: drop-off is " + miles
                            + " miles from the kitchen; delivery is limited to "
                            + (int) DELIVERY_RADIUS_MILES + " miles. Offer pickup or a closer address.");
        }
    }

    /** FR10: step-by-step address disclosure — street address only on a confirmed pickup order. */
    public OrderDetailResponse detail(String buyerId, String orderId) {
        record OrderRow(String id, String buyerId, String kitchenId, String menuDayId, String status,
                LocalDateTime readySlot, String fulfillment, int totalCents, int commissionCents,
                String paymentIntentId, LocalDateTime refundedAt, String idempotencyKey,
                LocalDateTime createdAt, String kitchenName, String addressEncrypted) {
        }
        OrderRow order = db.sql("""
                SELECT o.*, k.name AS kitchen_name, k."addressEncrypted"
                FROM "Order" o
                JOIN "Kitchen" k ON k.id = o."kitchenId"
                WHERE o.id = :id
                """)
                .param("id", orderId)
                .query((rs, n) -> new OrderRow(
                        rs.getString("id"), rs.getString("buyerId"), rs.getString("kitchenId"),
                        rs.getString("menuDayId"), rs.getString("status"),
                        rs.getTimestamp("readySlot").toLocalDateTime(), rs.getString("fulfillment"),
                        rs.getInt("totalCents"), rs.getInt("commissionCents"),
                        rs.getString("paymentIntentId"),
                        rs.getTimestamp("refundedAt") == null
                                ? null
                                : rs.getTimestamp("refundedAt").toLocalDateTime(),
                        rs.getString("idempotencyKey"),
                        rs.getTimestamp("createdAt").toLocalDateTime(),
                        rs.getString("kitchen_name"), rs.getString("addressEncrypted")))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!order.buyerId().equals(buyerId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN); // MCP AC4: buyer scope
        }

        List<OrderDetailResponse.Item> items = db.sql("""
                SELECT oi.id, oi."orderId", oi."menuItemId", oi.qty, oi."unitPriceCents",
                       mi."menuDayId", mi."dishId", mi."portionsTotal", mi."portionsRemaining",
                       d."kitchenId" AS dish_kitchen_id, d.name, d.description, d.photo, d.calories,
                       d."priceCents", d."dietaryTags"
                FROM "OrderItem" oi
                JOIN "MenuItem" mi ON mi.id = oi."menuItemId"
                JOIN "Dish" d ON d.id = mi."dishId"
                WHERE oi."orderId" = :orderId
                """)
                .param("orderId", orderId)
                .query((rs, n) -> new OrderDetailResponse.Item(
                        rs.getString("id"),
                        rs.getString("orderId"),
                        rs.getString("menuItemId"),
                        rs.getInt("qty"),
                        rs.getInt("unitPriceCents"),
                        new OrderDetailResponse.MenuItemRef(
                                rs.getString("menuItemId"),
                                rs.getString("menuDayId"),
                                rs.getString("dishId"),
                                rs.getInt("portionsTotal"),
                                rs.getInt("portionsRemaining"),
                                new MenuDayResponse.Dish(
                                        rs.getString("dishId"),
                                        rs.getString("dish_kitchen_id"),
                                        rs.getString("name"),
                                        rs.getString("description"),
                                        rs.getString("photo"),
                                        rs.getObject("calories", Integer.class),
                                        rs.getInt("priceCents"),
                                        stringList(rs, "dietaryTags")))))
                .list();

        boolean discloseAddress = "pickup".equals(order.fulfillment())
                && !"pending".equals(order.status())
                && !"cancelled".equals(order.status());
        return new OrderDetailResponse(
                order.id(), order.buyerId(), order.kitchenId(), order.menuDayId(), order.status(),
                order.readySlot(), order.fulfillment(), order.totalCents(), order.commissionCents(),
                order.paymentIntentId(), order.refundedAt(), order.idempotencyKey(), order.createdAt(),
                items, order.kitchenName(),
                discloseAddress ? addressCrypto.decrypt(order.addressEncrypted()) : null,
                deliveryService.findByOrderId(orderId));
    }

    /**
     * Story 4.1 — seller lifecycle transition. On decline, portions are restored in the same
     * transaction (Story 2.3 AC2); on ready for a delivery order, the DeliveryJob is created
     * via the provider interface (Story 4.2 AC2).
     */
    @Transactional
    public Map<String, Object> transition(String sellerId, String orderId, String target) {
        record Row(String status, String fulfillment, String kitchenSellerId, String buyerId,
                String kitchenName, String paymentIntentId, int totalCents) {
        }
        Row order = db.sql("""
                SELECT o.status, o.fulfillment, k."sellerId" AS kitchen_seller_id,
                       o."buyerId", k.name AS kitchen_name, o."paymentIntentId", o."totalCents"
                FROM "Order" o JOIN "Kitchen" k ON k.id = o."kitchenId"
                WHERE o.id = :id
                FOR UPDATE OF o
                """)
                .param("id", orderId)
                .query((rs, n) -> new Row(
                        rs.getString("status"), rs.getString("fulfillment"),
                        rs.getString("kitchen_seller_id"), rs.getString("buyerId"),
                        rs.getString("kitchen_name"), rs.getString("paymentIntentId"),
                        rs.getInt("totalCents")))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!sellerId.equals(order.kitchenSellerId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        if (!SELLER_TRANSITIONS.getOrDefault(order.status(), Set.of()).contains(target)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "INVALID_TRANSITION:" + order.status() + "->" + target);
        }

        boolean refunded = false;
        if ("declined".equals(target)) {
            record ItemQty(String menuItemId, int qty) {
            }
            List<ItemQty> items = db
                    .sql("SELECT \"menuItemId\", qty FROM \"OrderItem\" WHERE \"orderId\" = :id")
                    .param("id", orderId)
                    .query((rs, n) -> new ItemQty(rs.getString("menuItemId"), rs.getInt("qty")))
                    .list();
            for (ItemQty item : items) {
                inventory.restore(item.menuItemId(), item.qty()); // Story 2.3 AC2
            }
            eventPublisher.publishEvent(new PortionsChanged(items.stream().map(ItemQty::menuItemId).toList()));
            // FR21 — a declined order was already paid (confirmed): refund automatically.
            refunded = order.paymentIntentId() != null
                    && issueRefund(orderId, order.paymentIntentId(), order.totalCents()) != null;
        }

        db.sql("UPDATE \"Order\" SET status = :status WHERE id = :id")
                .param("status", target)
                .param("id", orderId)
                .update();

        Map<String, Object> deliveryJob = null;
        if ("ready".equals(target) && "delivery".equals(order.fulfillment())) {
            deliveryJob = deliveryService.createForOrder(orderId, sellerId);
        }

        // FR22 — the buyer follows every seller-driven status change.
        String trackingUrl = deliveryJob == null ? null : (String) deliveryJob.get("trackingUrl");
        Map<String, Object> data = trackingUrl == null
                ? Map.of("orderId", orderId)
                : Map.of("orderId", orderId, "trackingUrl", trackingUrl);
        switch (target) {
            case "accepted" -> notifications.notify(order.buyerId(), "order_accepted", "Order accepted",
                    order.kitchenName() + " accepted your order.", data);
            case "declined" -> notifications.notify(order.buyerId(), "order_declined", "Order declined",
                    order.kitchenName() + " couldn't take your order — "
                            + (refunded
                                    ? "your payment was refunded in full."
                                    : "your portions were released."),
                    data);
            case "preparing" -> notifications.notify(order.buyerId(), "order_preparing", "In the kitchen",
                    order.kitchenName() + " is preparing your food.", data);
            case "ready" -> notifications.notify(order.buyerId(), "order_ready",
                    "delivery".equals(order.fulfillment())
                            ? "Ready — courier on the way" : "Ready for pickup",
                    "Your order at " + order.kitchenName() + " is ready.", data);
            case "completed" -> notifications.notify(order.buyerId(), "order_completed", "Order completed",
                    "Enjoy your meal from " + order.kitchenName() + "!", data);
            default -> {
            }
        }

        db.sql("""
                INSERT INTO "AuditLog" (id, actor, entity, action, "after")
                VALUES (:id, :actor, :entity, 'order_status', :after::jsonb)
                """)
                .param("id", UUID.randomUUID().toString())
                .param("actor", sellerId)
                .param("entity", "Order:" + orderId)
                .param("after", jsonMapper.writeValueAsString(
                        Map.of("from", order.status(), "to", target)))
                .update();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", orderId);
        result.put("status", target);
        if (deliveryJob != null) {
            result.put("deliveryJob", deliveryJob);
        }
        return result;
    }

    /** Story 4.1 — seller order dashboard listing for one kitchen. */
    public List<Map<String, Object>> listForKitchen(String sellerId, String kitchenId, String status) {
        String ownerId = db.sql("SELECT \"sellerId\" FROM \"Kitchen\" WHERE id = :id")
                .param("id", kitchenId)
                .query(String.class)
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "KITCHEN_NOT_FOUND"));
        if (!ownerId.equals(sellerId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        return db.sql("""
                SELECT o.id, o.status, o."readySlot", o.fulfillment, o."totalCents",
                       o."deliveryFeeCents", o."tipCents", o."createdAt",
                       dj.provider AS delivery_provider, dj.status AS delivery_status,
                       dj."trackingUrl" AS delivery_tracking_url,
                       u.email AS buyer_email, u.phone AS buyer_phone,
                       (SELECT string_agg(d.name || ' x' || oi.qty, ', ' ORDER BY d.name)
                        FROM "OrderItem" oi
                        JOIN "MenuItem" mi ON mi.id = oi."menuItemId"
                        JOIN "Dish" d ON d.id = mi."dishId"
                        WHERE oi."orderId" = o.id) AS items_summary,
                       (SELECT json_agg(json_build_object('name', d.name, 'qty', oi.qty, 'photo', d.photo)
                                         ORDER BY d.name)
                        FROM "OrderItem" oi
                        JOIN "MenuItem" mi ON mi.id = oi."menuItemId"
                        JOIN "Dish" d ON d.id = mi."dishId"
                        WHERE oi."orderId" = o.id) AS items_json
                FROM "Order" o
                JOIN "User" u ON u.id = o."buyerId"
                LEFT JOIN "DeliveryJob" dj ON dj."orderId" = o.id
                WHERE o."kitchenId" = :kitchenId
                  AND (:status::text IS NULL OR o.status::text = :status)
                ORDER BY o."createdAt" DESC
                LIMIT 200
                """)
                .param("kitchenId", kitchenId)
                .param("status", status, java.sql.Types.VARCHAR)
                .query((rs, n) -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", rs.getString("id"));
                    row.put("status", rs.getString("status"));
                    row.put("readySlot", rs.getTimestamp("readySlot").toLocalDateTime());
                    row.put("fulfillment", rs.getString("fulfillment"));
                    row.put("totalCents", rs.getInt("totalCents"));
                    row.put("deliveryFeeCents", rs.getInt("deliveryFeeCents"));
                    row.put("tipCents", rs.getInt("tipCents"));
                    row.put("createdAt", rs.getTimestamp("createdAt").toLocalDateTime());
                    row.put("itemsSummary", rs.getString("items_summary"));
                    row.put("items", parseItemsJson(rs.getString("items_json")));
                    row.put("buyerEmail", rs.getString("buyer_email"));
                    row.put("buyerPhone", rs.getString("buyer_phone"));
                    // Story 4.1 board — delivery-partner status chip (null for pickup / pre-ready)
                    row.put("deliveryProvider", rs.getString("delivery_provider"));
                    row.put("deliveryStatus", rs.getString("delivery_status"));
                    row.put("deliveryTrackingUrl", rs.getString("delivery_tracking_url"));
                    return row;
                })
                .list();
    }

    /** items_json is a Postgres json_agg(...) array, null when an order somehow has no lines. */
    private List<Map<String, Object>> parseItemsJson(String itemsJson) {
        if (itemsJson == null) return List.of();
        return jsonMapper.readValue(itemsJson, List.class);
    }

    /** Buyer order history — mirrors listForKitchen but scoped to the buyer's own orders. */
    public List<Map<String, Object>> listForBuyer(String buyerId, String status) {
        return db.sql("""
                SELECT o.id, o.status, o."readySlot", o.fulfillment, o."totalCents", o."createdAt",
                       k.name AS kitchen_name, k."cuisineTag" AS cuisine_tag,
                       dj."trackingUrl" AS delivery_tracking_url,
                       (r.id IS NOT NULL) AS reviewed,
                       (SELECT string_agg(d.name || ' x' || oi.qty, ', ' ORDER BY d.name)
                        FROM "OrderItem" oi
                        JOIN "MenuItem" mi ON mi.id = oi."menuItemId"
                        JOIN "Dish" d ON d.id = mi."dishId"
                        WHERE oi."orderId" = o.id) AS items_summary
                FROM "Order" o
                JOIN "Kitchen" k ON k.id = o."kitchenId"
                LEFT JOIN "DeliveryJob" dj ON dj."orderId" = o.id
                LEFT JOIN "Review" r ON r."orderId" = o.id
                WHERE o."buyerId" = :buyerId
                  AND (:status::text IS NULL OR o.status::text = :status)
                ORDER BY o."createdAt" DESC
                LIMIT 200
                """)
                .param("buyerId", buyerId)
                .param("status", status, java.sql.Types.VARCHAR)
                .query((rs, n) -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", rs.getString("id"));
                    row.put("status", rs.getString("status"));
                    row.put("readySlot", rs.getTimestamp("readySlot").toLocalDateTime());
                    row.put("fulfillment", rs.getString("fulfillment"));
                    row.put("totalCents", rs.getInt("totalCents"));
                    row.put("createdAt", rs.getTimestamp("createdAt").toLocalDateTime());
                    row.put("kitchenName", rs.getString("kitchen_name"));
                    row.put("cuisineTag", rs.getString("cuisine_tag"));
                    row.put("itemsSummary", rs.getString("items_summary"));
                    row.put("deliveryTrackingUrl", rs.getString("delivery_tracking_url"));
                    row.put("reviewed", rs.getBoolean("reviewed"));
                    return row;
                })
                .list();
    }

    @Transactional
    public Map<String, Object> cancel(String buyerId, String orderId) {
        Map<String, Object> order = db.sql("SELECT * FROM \"Order\" WHERE id = :id FOR UPDATE")
                .param("id", orderId)
                .query((rs, n) -> orderRowAsMap(rs))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!buyerId.equals(order.get("buyerId"))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        if (!CANCELLABLE.contains((String) order.get("status"))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "NOT_CANCELLABLE");
        }
        String previousStatus = (String) order.get("status");
        // Pending = the buyer may still have an open payment sheet: cancel the intent first
        // so the money can't be captured after we release the portions. If the intent is
        // already terminal (paid a moment ago), let the succeeded webhook settle it instead.
        if ("pending".equals(previousStatus)
                && order.get("paymentIntentId") != null
                && !payments.tryCancelIntent((String) order.get("paymentIntentId"))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "PAYMENT_SETTLING");
        }
        record ItemQty(String menuItemId, int qty) {
        }
        List<ItemQty> items = db.sql("SELECT \"menuItemId\", qty FROM \"OrderItem\" WHERE \"orderId\" = :id")
                .param("id", orderId)
                .query((rs, n) -> new ItemQty(rs.getString("menuItemId"), rs.getInt("qty")))
                .list();
        for (ItemQty item : items) {
            inventory.restore(item.menuItemId(), item.qty()); // refund in the same transaction (AC2)
        }
        db.sql("UPDATE \"Order\" SET status = 'cancelled' WHERE id = :id").param("id", orderId).update();
        order.put("status", "cancelled");
        // FR21 — anything past pending was already captured: refund automatically and
        // tell the buyer (the pending path above never captured, so nothing to return).
        if (!"pending".equals(previousStatus) && order.get("paymentIntentId") != null) {
            String refundId = issueRefund(
                    orderId, (String) order.get("paymentIntentId"), (Integer) order.get("totalCents"));
            if (refundId != null) {
                order.put("refundId", refundId);
                notifications.notify(buyerId, "payment_refunded", "Refund issued",
                        String.format("Your $%.2f payment is on its way back to you.",
                                ((Integer) order.get("totalCents")) / 100.0),
                        Map.of("orderId", orderId));
            }
        }
        // FR22 — the seller learns the slot freed up.
        String sellerId = db.sql("SELECT \"sellerId\" FROM \"Kitchen\" WHERE id = :id")
                .param("id", order.get("kitchenId"))
                .query(String.class)
                .single();
        notifications.notify(sellerId, "order_cancelled", "Order cancelled",
                "The buyer cancelled an order — its portions are back in stock.",
                Map.of("orderId", orderId));
        eventPublisher.publishEvent(new PortionsChanged(items.stream().map(ItemQty::menuItemId).toList()));
        return order;
    }

    public OrderDetailResponse status(String buyerId, String orderId) {
        return detail(buyerId, orderId);
    }

    private static Map<String, Object> orderRowAsMap(ResultSet rs) throws SQLException {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", rs.getString("id"));
        row.put("buyerId", rs.getString("buyerId"));
        row.put("kitchenId", rs.getString("kitchenId"));
        row.put("menuDayId", rs.getString("menuDayId"));
        row.put("status", rs.getString("status"));
        row.put("readySlot", rs.getTimestamp("readySlot").toLocalDateTime());
        row.put("fulfillment", rs.getString("fulfillment"));
        row.put("totalCents", rs.getInt("totalCents"));
        row.put("commissionCents", rs.getInt("commissionCents"));
        row.put("paymentIntentId", rs.getString("paymentIntentId"));
        row.put("idempotencyKey", rs.getString("idempotencyKey"));
        row.put("createdAt", rs.getTimestamp("createdAt").toLocalDateTime());
        return row;
    }

    /**
     * FR21 — refund a captured payment through the provider. Failures never block the
     * order transition: they are audited (refund_failed) for manual follow-up instead.
     */
    private String issueRefund(String orderId, String paymentIntentId, int totalCents) {
        String refundId = payments.refund(paymentIntentId, totalCents);
        if (refundId == null) {
            db.sql("""
                    INSERT INTO "AuditLog" (id, actor, entity, action, "after")
                    VALUES (:id, 'payments', :entity, 'refund_failed', :after::jsonb)
                    """)
                    .param("id", UUID.randomUUID().toString())
                    .param("entity", "Order:" + orderId)
                    .param("after", jsonMapper.writeValueAsString(
                            Map.of("paymentIntentId", paymentIntentId, "amountCents", totalCents)))
                    .update();
            return null;
        }
        db.sql("UPDATE \"Order\" SET \"refundId\" = :refundId, \"refundedAt\" = now() WHERE id = :id")
                .param("refundId", refundId)
                .param("id", orderId)
                .update();
        db.sql("""
                INSERT INTO "AuditLog" (id, actor, entity, action, "after")
                VALUES (:id, 'payments', :entity, 'payment_refunded', :after::jsonb)
                """)
                .param("id", UUID.randomUUID().toString())
                .param("entity", "Order:" + orderId)
                .param("after", jsonMapper.writeValueAsString(
                        Map.of("refundId", refundId, "amountCents", totalCents)))
                .update();
        return refundId;
    }

    /** Accepts ISO datetimes with or without offset, mirroring JS `new Date(string)`. */
    private static LocalDateTime parseReadySlot(String value) {
        String v = value.trim();
        try {
            return LocalDateTime.ofInstant(Instant.parse(v), ZoneOffset.UTC);
        } catch (DateTimeParseException ignored) {
        }
        try {
            return LocalDateTime.parse(v);
        } catch (DateTimeParseException ignored) {
        }
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("^(\\d{1,2}):(\\d{2})").matcher(v);
        if (m.find()) {
            int hour = Integer.parseInt(m.group(1));
            int minute = Integer.parseInt(m.group(2));
            if (hour <= 23 && minute <= 59) {
                return java.time.LocalDate.now(ZoneOffset.UTC).atTime(hour, minute);
            }
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "READY_SLOT_INVALID: use ISO datetime (2026-07-10T17:00:00Z) or HH:mm");
    }

    private static List<String> stringList(ResultSet rs, String column) throws SQLException {
        java.sql.Array array = rs.getArray(column);
        return array == null ? List.of() : Arrays.asList((String[]) array.getArray());
    }
}
