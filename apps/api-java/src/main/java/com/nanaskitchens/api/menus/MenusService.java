package com.nanaskitchens.api.menus;

import com.nanaskitchens.api.audit.AuditLog;
import com.nanaskitchens.api.audit.AuditLogRepository;
import com.nanaskitchens.api.kitchens.dto.MenuDayResponse;
import com.nanaskitchens.api.menus.dto.CreateMenuDayRequest;
import com.nanaskitchens.api.menus.dto.DishRequest;
import com.nanaskitchens.api.menus.dto.ReadyWindow;
import com.nanaskitchens.api.menus.dto.UpdateMenuDayRequest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

/**
 * Story 2.1 (dish & menu CRUD) + Story 2.2 (ready-time windows). Seller-scoped: every call
 * verifies the JWT user owns the kitchen. Published menu days are immutable here — portion
 * corrections on live menus are Story 2.3's manual-correction endpoint.
 */
@Service
public class MenusService {

    private final JdbcClient db;
    private final AuditLogRepository auditLogRepository;
    private final JsonMapper jsonMapper;

    public MenusService(JdbcClient db, AuditLogRepository auditLogRepository, JsonMapper jsonMapper) {
        this.db = db;
        this.auditLogRepository = auditLogRepository;
        this.jsonMapper = jsonMapper;
    }

    // ── Dishes (Story 2.1) ────────────────────────────────────────────────────

    @Transactional
    public MenuDayResponse.Dish createDish(String sellerId, String kitchenId, DishRequest input) {
        requireOwnedKitchen(sellerId, kitchenId);
        String id = UUID.randomUUID().toString();
        db.sql("""
                INSERT INTO "Dish" (id, "kitchenId", name, description, photo, "priceCents", "dietaryTags")
                VALUES (:id, :kitchenId, :name, :description, :photo, :priceCents, :dietaryTags)
                """)
                .param("id", id)
                .param("kitchenId", kitchenId)
                .param("name", input.name())
                .param("description", input.description())
                .param("photo", input.photo())
                .param("priceCents", input.priceCents())
                .param("dietaryTags", toSqlArray(input.dietaryTags()))
                .update();
        return getDish(kitchenId, id);
    }

    public List<MenuDayResponse.Dish> listDishes(String sellerId, String kitchenId) {
        requireOwnedKitchen(sellerId, kitchenId);
        return db.sql("SELECT * FROM \"Dish\" WHERE \"kitchenId\" = :kitchenId ORDER BY name")
                .param("kitchenId", kitchenId)
                .query((rs, n) -> dishFromRow(rs))
                .list();
    }

    @Transactional
    public MenuDayResponse.Dish updateDish(
            String sellerId, String kitchenId, String dishId, DishRequest.Patch patch) {
        requireOwnedKitchen(sellerId, kitchenId);
        MenuDayResponse.Dish current = getDish(kitchenId, dishId);
        db.sql("""
                UPDATE "Dish" SET name = :name, description = :description, photo = :photo,
                       "priceCents" = :priceCents, "dietaryTags" = :dietaryTags
                WHERE id = :id AND "kitchenId" = :kitchenId
                """)
                .param("name", patch.name() != null ? patch.name() : current.name())
                .param("description", patch.description() != null ? patch.description() : current.description())
                .param("photo", patch.photo() != null ? patch.photo() : current.photo())
                .param("priceCents", patch.priceCents() != null ? patch.priceCents() : current.priceCents())
                .param("dietaryTags",
                        toSqlArray(patch.dietaryTags() != null ? patch.dietaryTags() : current.dietaryTags()))
                .param("id", dishId)
                .param("kitchenId", kitchenId)
                .update();
        return getDish(kitchenId, dishId);
    }

    @Transactional
    public void deleteDish(String sellerId, String kitchenId, String dishId) {
        requireOwnedKitchen(sellerId, kitchenId);
        getDish(kitchenId, dishId); // 404 if not this kitchen's dish
        Integer used = db.sql("SELECT count(*)::int FROM \"MenuItem\" WHERE \"dishId\" = :dishId")
                .param("dishId", dishId)
                .query(Integer.class)
                .single();
        if (used > 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "DISH_IN_USE");
        }
        db.sql("DELETE FROM \"Dish\" WHERE id = :id").param("id", dishId).update();
    }

    // ── Menu days (Story 2.1 + 2.2) ───────────────────────────────────────────

    @Transactional
    public MenuDayResponse createMenuDay(String sellerId, String kitchenId, CreateMenuDayRequest input) {
        requireOwnedKitchen(sellerId, kitchenId);
        LocalDate date = parseDate(input.date());
        validateWindows(input.readyWindows());
        List<CreateMenuDayRequest.Item> items = input.items() != null ? input.items() : List.of();
        requireDishesOwned(kitchenId, items);

        Integer existing = db.sql("""
                SELECT count(*)::int FROM "MenuDay" WHERE "kitchenId" = :kitchenId AND date = :date
                """)
                .param("kitchenId", kitchenId)
                .param("date", date)
                .query(Integer.class)
                .single();
        if (existing > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "MENU_DAY_EXISTS");
        }

        String menuDayId = UUID.randomUUID().toString();
        db.sql("""
                INSERT INTO "MenuDay" (id, "kitchenId", date, status, "readyWindows")
                VALUES (:id, :kitchenId, :date, 'draft', :readyWindows::jsonb)
                """)
                .param("id", menuDayId)
                .param("kitchenId", kitchenId)
                .param("date", date)
                .param("readyWindows", jsonMapper.writeValueAsString(input.readyWindows()))
                .update();
        insertItems(menuDayId, items);
        return loadMenuDay(menuDayId);
    }

    public List<MenuDayResponse> listMenuDays(String sellerId, String kitchenId, String date) {
        requireOwnedKitchen(sellerId, kitchenId);
        List<String> ids = date != null && !date.isBlank()
                ? db.sql("SELECT id FROM \"MenuDay\" WHERE \"kitchenId\" = :k AND date = :d")
                        .param("k", kitchenId).param("d", parseDate(date)).query(String.class).list()
                : db.sql("SELECT id FROM \"MenuDay\" WHERE \"kitchenId\" = :k ORDER BY date DESC LIMIT 60")
                        .param("k", kitchenId).query(String.class).list();
        return ids.stream().map(this::loadMenuDay).toList();
    }

    @Transactional
    public MenuDayResponse updateMenuDay(
            String sellerId, String kitchenId, String menuDayId, UpdateMenuDayRequest input) {
        requireOwnedKitchen(sellerId, kitchenId);
        requireDraft(kitchenId, menuDayId);
        if (input.readyWindows() != null) {
            validateWindows(input.readyWindows());
            db.sql("UPDATE \"MenuDay\" SET \"readyWindows\" = :rw::jsonb WHERE id = :id")
                    .param("rw", jsonMapper.writeValueAsString(input.readyWindows()))
                    .param("id", menuDayId)
                    .update();
        }
        if (input.items() != null) {
            requireDishesOwned(kitchenId, input.items());
            // Draft menus have no orders, so a full replace is safe.
            db.sql("DELETE FROM \"MenuItem\" WHERE \"menuDayId\" = :id").param("id", menuDayId).update();
            insertItems(menuDayId, input.items());
        }
        return loadMenuDay(menuDayId);
    }

    @Transactional
    public MenuDayResponse publish(String sellerId, String kitchenId, String menuDayId) {
        Map<String, Object> kitchen = requireOwnedKitchen(sellerId, kitchenId);
        if (kitchen.get("complianceAttestedAt") == null) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "PUBLISH_REQUIRES_ATTESTATION");
        }
        requireDraft(kitchenId, menuDayId);
        Integer itemCount = db.sql("SELECT count(*)::int FROM \"MenuItem\" WHERE \"menuDayId\" = :id")
                .param("id", menuDayId)
                .query(Integer.class)
                .single();
        if (itemCount == 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "MENU_DAY_EMPTY");
        }
        db.sql("UPDATE \"MenuDay\" SET status = 'published' WHERE id = :id").param("id", menuDayId).update();
        AuditLog log = new AuditLog();
        log.setActor(sellerId);
        log.setEntity("MenuDay:" + menuDayId);
        log.setAction("publish_menu");
        auditLogRepository.save(log);
        return loadMenuDay(menuDayId);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private Map<String, Object> requireOwnedKitchen(String sellerId, String kitchenId) {
        Map<String, Object> kitchen = db.sql("""
                SELECT "sellerId", "complianceAttestedAt" FROM "Kitchen" WHERE id = :id
                """)
                .param("id", kitchenId)
                .query((rs, n) -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("sellerId", rs.getString("sellerId"));
                    row.put("complianceAttestedAt", rs.getTimestamp("complianceAttestedAt"));
                    return row;
                })
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "KITCHEN_NOT_FOUND"));
        if (!sellerId.equals(kitchen.get("sellerId"))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        return kitchen;
    }

    private void requireDraft(String kitchenId, String menuDayId) {
        if (db.sql("SELECT count(*) FROM \"Poll\" WHERE \"menuDayId\" = :id AND \"finalizedAt\" IS NULL")
                .param("id", menuDayId).query(Integer.class).single() > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "POLL_MENU_MANAGED");
        }
        String status = db.sql("""
                SELECT status::text FROM "MenuDay" WHERE id = :id AND "kitchenId" = :kitchenId
                """)
                .param("id", menuDayId)
                .param("kitchenId", kitchenId)
                .query(String.class)
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "MENU_DAY_NOT_FOUND"));
        if (!"draft".equals(status)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "MENU_DAY_NOT_DRAFT");
        }
    }

    private void requireDishesOwned(String kitchenId, List<CreateMenuDayRequest.Item> items) {
        if (items.isEmpty()) {
            return;
        }
        Set<String> dishIds = new HashSet<>();
        for (CreateMenuDayRequest.Item item : items) {
            if (!dishIds.add(item.dishId())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "DUPLICATE_DISH:" + item.dishId());
            }
        }
        List<String> owned = db.sql("""
                SELECT id FROM "Dish" WHERE "kitchenId" = :kitchenId AND id IN (:ids)
                """)
                .param("kitchenId", kitchenId)
                .param("ids", List.copyOf(dishIds))
                .query(String.class)
                .list();
        dishIds.removeAll(new HashSet<>(owned));
        if (!dishIds.isEmpty()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "DISH_NOT_IN_KITCHEN:" + dishIds.iterator().next());
        }
    }

    /** Story 2.2: HH:mm bounds, start < end, and no overlapping windows. */
    private static void validateWindows(List<ReadyWindow> windows) {
        if (windows == null || windows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "READY_WINDOWS_REQUIRED");
        }
        List<ReadyWindow> sorted = new ArrayList<>(windows);
        sorted.sort(Comparator.comparingInt(ReadyWindow::startMinutes));
        int previousEnd = -1;
        for (ReadyWindow window : sorted) {
            if (window.startMinutes() >= window.endMinutes()) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST, "WINDOW_INVALID:" + window.start() + "-" + window.end());
            }
            if (window.startMinutes() < previousEnd) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "WINDOWS_OVERLAP");
            }
            previousEnd = window.endMinutes();
        }
    }

    private void insertItems(String menuDayId, List<CreateMenuDayRequest.Item> items) {
        for (CreateMenuDayRequest.Item item : items) {
            db.sql("""
                    INSERT INTO "MenuItem" (id, "menuDayId", "dishId", "portionsTotal", "portionsRemaining")
                    VALUES (:id, :menuDayId, :dishId, :portionsTotal, :portionsTotal)
                    """)
                    .param("id", UUID.randomUUID().toString())
                    .param("menuDayId", menuDayId)
                    .param("dishId", item.dishId())
                    .param("portionsTotal", item.portionsTotal())
                    .update();
        }
    }

    private MenuDayResponse loadMenuDay(String menuDayId) {
        record Day(String id, String kitchenId, LocalDate date, String status, String readyWindows) {
        }
        Day day = db.sql("""
                SELECT id, "kitchenId", date, status::text AS status, "readyWindows"::text AS rw
                FROM "MenuDay" WHERE id = :id
                """)
                .param("id", menuDayId)
                .query((rs, n) -> new Day(rs.getString("id"), rs.getString("kitchenId"),
                        rs.getDate("date").toLocalDate(), rs.getString("status"), rs.getString("rw")))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "MENU_DAY_NOT_FOUND"));
        List<MenuDayResponse.Item> items = db.sql("""
                SELECT mi.id, mi."dishId", mi."portionsTotal", mi."portionsRemaining",
                       d."kitchenId" AS dish_kitchen_id, d.name, d.description, d.photo,
                       d."priceCents", d."dietaryTags"
                FROM "MenuItem" mi JOIN "Dish" d ON d.id = mi."dishId"
                WHERE mi."menuDayId" = :id
                ORDER BY d.name
                """)
                .param("id", menuDayId)
                .query((rs, n) -> new MenuDayResponse.Item(
                        rs.getString("id"),
                        menuDayId,
                        rs.getString("dishId"),
                        rs.getInt("portionsTotal"),
                        rs.getInt("portionsRemaining"),
                        new MenuDayResponse.Dish(
                                rs.getString("dishId"),
                                rs.getString("dish_kitchen_id"),
                               rs.getString("name"),
                               rs.getString("description"),
                               rs.getString("photo"),
                                null,
                                rs.getInt("priceCents"),
                                stringList(rs, "dietaryTags"))))
                .list();
        return new MenuDayResponse(
                day.id(), day.kitchenId(), day.date(), day.status(),
                jsonMapper.readTree(day.readyWindows()), items);
    }

    private MenuDayResponse.Dish getDish(String kitchenId, String dishId) {
        return db.sql("SELECT * FROM \"Dish\" WHERE id = :id AND \"kitchenId\" = :kitchenId")
                .param("id", dishId)
                .param("kitchenId", kitchenId)
                .query((rs, n) -> dishFromRow(rs))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "DISH_NOT_FOUND"));
    }

    private static MenuDayResponse.Dish dishFromRow(ResultSet rs) throws SQLException {
        return new MenuDayResponse.Dish(
                rs.getString("id"),
                rs.getString("kitchenId"),
                rs.getString("name"),
                rs.getString("description"),
                rs.getString("photo"),
                null,
                rs.getInt("priceCents"),
                stringList(rs, "dietaryTags"));
    }

    private static LocalDate parseDate(String value) {
        try {
            return LocalDate.parse(value.length() > 10 ? value.substring(0, 10) : value);
        } catch (DateTimeParseException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "DATE_INVALID");
        }
    }

    private static String[] toSqlArray(List<String> values) {
        return values == null ? new String[0] : values.toArray(String[]::new);
    }

    private static List<String> stringList(ResultSet rs, String column) throws SQLException {
        java.sql.Array array = rs.getArray(column);
        return array == null ? List.of() : Arrays.asList((String[]) array.getArray());
    }
}
