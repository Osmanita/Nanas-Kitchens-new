package com.nanaskitchens.api.inventory;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

/**
 * Ported from apps/api/src/inventory (Story 2.3).
 * NFR1 / FR8: NEVER read-then-write. A single conditional UPDATE guarantees concurrent
 * orders can't drive portions below zero; rowcount 0 means PORTIONS_CONFLICT.
 */
@Service
public class InventoryService {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(InventoryService.class);

    private final JdbcClient db;
    private final ApplicationEventPublisher events;
    private final JsonMapper jsonMapper;

    public InventoryService(JdbcClient db, ApplicationEventPublisher events, JsonMapper jsonMapper) {
        this.db = db;
        this.events = events;
        this.jsonMapper = jsonMapper;
    }

    /** Must run inside the caller's transaction (order placement). */
    public void decrement(String menuItemId, int qty) {
        int updated = db.sql("""
                UPDATE "MenuItem"
                SET "portionsRemaining" = "portionsRemaining" - :qty
                WHERE id = :id AND "portionsRemaining" >= :qty
                """)
                .param("qty", qty)
                .param("id", menuItemId)
                .update();
        if (updated == 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "PORTIONS_CONFLICT:" + menuItemId);
        }
    }

    /** Refund is capped at portionsTotal; runs inside the caller's transaction (Story 2.3 AC2). */
    public void restore(String menuItemId, int qty) {
        db.sql("""
                UPDATE "MenuItem"
                SET "portionsRemaining" = LEAST("portionsRemaining" + :qty, "portionsTotal")
                WHERE id = :id
                """)
                .param("qty", qty)
                .param("id", menuItemId)
                .update();
    }

    /**
     * Story 2.3 AC4 — seller manual correction (+/-). The floor is race-safe: a single UPDATE
     * with the committed-quantity aggregate inline rejects any decrement below what confirmed
     * orders already hold (invariant: committed + remaining == portionsTotal).
     */
    @Transactional
    public Map<String, Object> adjust(String sellerId, String menuItemId, int delta) {
        String ownerId = db.sql("""
                SELECT k."sellerId"
                FROM "MenuItem" mi
                JOIN "MenuDay" md ON md.id = mi."menuDayId"
                JOIN "Kitchen" k ON k.id = md."kitchenId"
                WHERE mi.id = :id
                """)
                .param("id", menuItemId)
                .query(String.class)
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "MENU_ITEM_NOT_FOUND"));
        if (!ownerId.equals(sellerId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        int updated = db.sql("""
                UPDATE "MenuItem" mi SET
                    "portionsTotal" = mi."portionsTotal" + :delta,
                    "portionsRemaining" = mi."portionsTotal" + :delta - c.committed
                FROM (
                    SELECT COALESCE(SUM(oi.qty), 0)::int AS committed
                    FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
                    WHERE oi."menuItemId" = :id AND o.status NOT IN ('cancelled', 'declined')
                ) c
                WHERE mi.id = :id AND mi."portionsTotal" + :delta >= c.committed
                  AND mi."portionsTotal" + :delta >= 0
                """)
                .param("delta", delta)
                .param("id", menuItemId)
                .update();
        if (updated == 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "ADJUST_BELOW_COMMITTED");
        }
        Map<String, Object> result = db.sql("""
                SELECT id, "portionsRemaining", "portionsTotal" FROM "MenuItem" WHERE id = :id
                """)
                .param("id", menuItemId)
                .query((rs, n) -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", rs.getString("id"));
                    row.put("portionsRemaining", rs.getInt("portionsRemaining"));
                    row.put("portionsTotal", rs.getInt("portionsTotal"));
                    return row;
                })
                .single();
        db.sql("""
                INSERT INTO "AuditLog" (id, actor, entity, action, "after")
                VALUES (:id, :actor, :entity, 'portions_adjust', :after::jsonb)
                """)
                .param("id", UUID.randomUUID().toString())
                .param("actor", sellerId)
                .param("entity", "MenuItem:" + menuItemId)
                .param("after", jsonMapper.writeValueAsString(Map.of("delta", delta, "result", result)))
                .update();
        events.publishEvent(new PortionsChanged(List.of(menuItemId)));
        return result;
    }

    public List<Map<String, Object>> remaining(List<String> menuItemIds) {
        if (menuItemIds == null || menuItemIds.isEmpty()) {
            return List.of();
        }
        log.info("checkPortions for menuItemIds: {}", menuItemIds);
        return db.sql("""
                SELECT id, "portionsRemaining", "portionsTotal" FROM "MenuItem" WHERE id IN (:ids)
                """)
                .param("ids", menuItemIds)
                .query((rs, rowNum) -> Map.<String, Object>of(
                        "id", rs.getString("id"),
                        "portionsRemaining", rs.getInt("portionsRemaining"),
                        "portionsTotal", rs.getInt("portionsTotal")))
                .list();
    }
}
