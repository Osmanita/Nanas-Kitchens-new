package com.nanaskitchens.api.reviews;

import com.nanaskitchens.api.notifications.NotificationsService;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Story 6.1 (FR16): a buyer rates a kitchen 1-5 only after a completed order, once per
 * order, within {@link #REVIEW_WINDOW_MONTHS} months of placing it. Kitchen.ratingAvg/
 * ratingCount are recomputed from the Review table on insert so the search results and
 * profile badge stay consistent with the raw rows.
 */
@Service
public class ReviewsService {

    private static final int REVIEW_WINDOW_MONTHS = 6;

    private final JdbcClient db;
    private final NotificationsService notifications;

    public ReviewsService(JdbcClient db, NotificationsService notifications) {
        this.db = db;
        this.notifications = notifications;
    }

    @Transactional
    public Map<String, Object> create(
            String buyerId, String kitchenId, String orderId, int rating, String comment) {
        record OrderRow(String buyerId, String kitchenId, String status, Instant createdAt) {
        }
        OrderRow order = db.sql("""
                SELECT "buyerId", "kitchenId", status::text AS status, "createdAt" FROM "Order" WHERE id = :id
                """)
                .param("id", orderId)
                .query((rs, n) -> new OrderRow(
                        rs.getString("buyerId"), rs.getString("kitchenId"), rs.getString("status"),
                        rs.getTimestamp("createdAt").toInstant()))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "ORDER_NOT_FOUND"));
        if (!buyerId.equals(order.buyerId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        if (!kitchenId.equals(order.kitchenId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "ORDER_KITCHEN_MISMATCH");
        }
        if (!"completed".equals(order.status())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "ORDER_NOT_COMPLETED");
        }
        Instant reviewWindowCutoff = Instant.now().atZone(ZoneOffset.UTC)
                .minusMonths(REVIEW_WINDOW_MONTHS).toInstant();
        if (order.createdAt().isBefore(reviewWindowCutoff)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "REVIEW_WINDOW_EXPIRED");
        }
        Integer existing = db.sql("SELECT count(*)::int FROM \"Review\" WHERE \"orderId\" = :orderId")
                .param("orderId", orderId)
                .query(Integer.class)
                .single();
        if (existing > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "ALREADY_REVIEWED");
        }

        String id = UUID.randomUUID().toString();
        db.sql("""
                INSERT INTO "Review" (id, "orderId", "kitchenId", "buyerId", rating, comment)
                VALUES (:id, :orderId, :kitchenId, :buyerId, :rating, :comment)
                """)
                .param("id", id)
                .param("orderId", orderId)
                .param("kitchenId", kitchenId)
                .param("buyerId", buyerId)
                .param("rating", rating)
                .param("comment", comment == null || comment.isBlank() ? null : comment.trim())
                .update();

        db.sql("""
                UPDATE "Kitchen" k SET
                    "ratingAvg" = agg.avg, "ratingCount" = agg.count
                FROM (
                    SELECT ROUND(AVG(rating)::numeric, 2)::float8 AS avg, count(*)::int AS count
                    FROM "Review" WHERE "kitchenId" = :kitchenId
                ) agg
                WHERE k.id = :kitchenId
                """)
                .param("kitchenId", kitchenId)
                .update();

        String sellerId = db.sql("SELECT \"sellerId\" FROM \"Kitchen\" WHERE id = :id")
                .param("id", kitchenId)
                .query(String.class)
                .single();
        notifications.notify(sellerId, "review_received", "New review",
                "★".repeat(rating) + " — a buyer reviewed a completed order.",
                Map.of("orderId", orderId));

        return get(orderId, buyerId);
    }

    /** Public list for the kitchen profile — buyer identity stays private. */
    public List<Map<String, Object>> listForKitchen(String kitchenId) {
        return db.sql("""
                SELECT id, rating, comment, "createdAt" FROM "Review"
                WHERE "kitchenId" = :kitchenId
                ORDER BY "createdAt" DESC
                LIMIT 50
                """)
                .param("kitchenId", kitchenId)
                .query((rs, n) -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", rs.getString("id"));
                    row.put("rating", rs.getInt("rating"));
                    row.put("comment", rs.getString("comment"));
                    row.put("createdAt", rs.getTimestamp("createdAt").toLocalDateTime());
                    return row;
                })
                .list();
    }

    /** The caller's own review of an order (404 until submitted) — drives the order-page form. */
    public Map<String, Object> get(String orderId, String buyerId) {
        return db.sql("""
                SELECT id, "kitchenId", rating, comment, "createdAt" FROM "Review"
                WHERE "orderId" = :orderId AND "buyerId" = :buyerId
                """)
                .param("orderId", orderId)
                .param("buyerId", buyerId)
                .query((rs, n) -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", rs.getString("id"));
                    row.put("kitchenId", rs.getString("kitchenId"));
                    row.put("rating", rs.getInt("rating"));
                    row.put("comment", rs.getString("comment"));
                    row.put("createdAt", rs.getTimestamp("createdAt").toLocalDateTime());
                    return (Map<String, Object>) row;
                })
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "REVIEW_NOT_FOUND"));
    }
}
