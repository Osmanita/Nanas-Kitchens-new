package com.nanaskitchens.api.orders;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Story S6 (front-end-spec Earnings; FR21) — seller payout view. Payout = the food subtotal
 * (totalCents − deliveryFeeCents − tipCents) − commissionCents (the 15% recorded on each Order
 * at checkout, itself charged on food only). The delivery fee is the courier provider's quote
 * and the tip is the courier's, so neither is the kitchen's money. "Paid out" counts only
 * completed orders; "upcoming" is money committed but still in the cooking flow.
 * Refunded / declined / cancelled orders never count.
 */
@RestController
public class EarningsController {

    private final JdbcClient db;

    public EarningsController(JdbcClient db) {
        this.db = db;
    }

    @GetMapping("/kitchens/{kitchenId}/earnings")
    @PreAuthorize("hasRole('SELLER')")
    public Map<String, Object> earnings(Authentication auth, @PathVariable String kitchenId) {
        String ownerId = db.sql("SELECT \"sellerId\" FROM \"Kitchen\" WHERE id = :id")
                .param("id", kitchenId)
                .query(String.class)
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "KITCHEN_NOT_FOUND"));
        if (!ownerId.equals(auth.getName())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }

        // One pass over the kitchen's orders, bucketed by lifecycle stage.
        record Totals(String bucket, int orders, long gross, long commission) {
        }
        List<Totals> rows = db.sql("""
                SELECT CASE
                         WHEN status = 'completed' THEN 'paid'
                         WHEN status IN ('confirmed','accepted','preparing','ready') THEN 'upcoming'
                         ELSE 'other'
                       END AS bucket,
                       count(*)::int AS orders,
                       -- the courier's delivery fee and the courier tip only pass through the
                       -- kitchen's order; they are not its sales, which is also why OrdersService
                       -- charges the 15% commission on the food subtotal alone
                       COALESCE(SUM("totalCents" - "deliveryFeeCents" - "tipCents"),0)::bigint AS gross,
                       COALESCE(SUM("commissionCents"),0)::bigint AS commission
                FROM "Order"
                WHERE "kitchenId" = :kitchenId
                GROUP BY bucket
                """)
                .param("kitchenId", kitchenId)
                .query((rs, n) -> new Totals(
                        rs.getString("bucket"), rs.getInt("orders"),
                        rs.getLong("gross"), rs.getLong("commission")))
                .list();

        Map<String, Object> paid = bucket();
        Map<String, Object> upcoming = bucket();
        for (Totals t : rows) {
            Map<String, Object> target = "paid".equals(t.bucket()) ? paid
                    : "upcoming".equals(t.bucket()) ? upcoming : null;
            if (target != null) {
                target.put("orders", t.orders());
                target.put("grossCents", t.gross());
                target.put("commissionCents", t.commission());
                target.put("netCents", t.gross() - t.commission());
            }
        }

        // Last 14 days of completed payout, oldest→newest, for a simple bar chart. UTC
        // "today" throughout — CURRENT_DATE would use the JDBC session's local timezone
        // (see CLAUDE.md's daily-menu-trap; same bug class as KitchensService.search).
        List<Map<String, Object>> daily = db.sql("""
                SELECT (d::date)::text AS day,
                       COALESCE(SUM(o."totalCents" - o."deliveryFeeCents" - o."tipCents"
                                    - o."commissionCents"),0)::bigint AS net
                FROM generate_series(
                       (now() AT TIME ZONE 'UTC')::date - INTERVAL '13 days',
                       (now() AT TIME ZONE 'UTC')::date,
                       INTERVAL '1 day') d
                LEFT JOIN "Order" o
                  ON o."kitchenId" = :kitchenId AND o.status = 'completed'
                  AND date_trunc('day', o."createdAt") = d
                GROUP BY day
                ORDER BY day
                """)
                .param("kitchenId", kitchenId)
                .query((rs, n) -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("day", rs.getString("day"));
                    row.put("netCents", rs.getLong("net"));
                    return row;
                })
                .list();

        // Recent payouts feed the transactions list.
        List<Map<String, Object>> recent = db.sql("""
                SELECT o.id, o."totalCents", o."commissionCents",
                       o."deliveryFeeCents", o."tipCents", o.fulfillment, o."createdAt",
                       (SELECT string_agg(dsh.name || ' x' || oi.qty, ', ' ORDER BY dsh.name)
                        FROM "OrderItem" oi
                        JOIN "MenuItem" mi ON mi.id = oi."menuItemId"
                        JOIN "Dish" dsh ON dsh.id = mi."dishId"
                        WHERE oi."orderId" = o.id) AS items_summary
                FROM "Order" o
                WHERE o."kitchenId" = :kitchenId AND o.status = 'completed'
                ORDER BY o."createdAt" DESC
                LIMIT 20
                """)
                .param("kitchenId", kitchenId)
                .query((rs, n) -> {
                    // gross = what the kitchen actually sold, i.e. without the courier's
                    // delivery fee and tip, so gross - commission still equals the payout
                    long sellerGross = rs.getLong("totalCents")
                            - rs.getLong("deliveryFeeCents") - rs.getLong("tipCents");
                    long net = sellerGross - rs.getLong("commissionCents");
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", rs.getString("id"));
                    row.put("grossCents", sellerGross);
                    row.put("commissionCents", rs.getInt("commissionCents"));
                    row.put("netCents", net);
                    row.put("fulfillment", rs.getString("fulfillment"));
                    row.put("itemsSummary", rs.getString("items_summary"));
                    row.put("createdAt", rs.getTimestamp("createdAt").toLocalDateTime());
                    return row;
                })
                .list();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("paid", paid);
        result.put("upcoming", upcoming);
        result.put("daily", daily);
        result.put("recent", recent);
        result.put("today", LocalDate.now(ZoneOffset.UTC).toString());
        return result;
    }

    private static Map<String, Object> bucket() {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("orders", 0);
        b.put("grossCents", 0L);
        b.put("commissionCents", 0L);
        b.put("netCents", 0L);
        return b;
    }
}
