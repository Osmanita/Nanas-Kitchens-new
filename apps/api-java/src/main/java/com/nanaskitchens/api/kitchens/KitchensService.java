package com.nanaskitchens.api.kitchens;

import com.nanaskitchens.api.audit.AuditLog;
import com.nanaskitchens.api.audit.AuditLogRepository;
import com.nanaskitchens.api.kitchens.dto.CreateKitchenRequest;
import com.nanaskitchens.api.kitchens.dto.KitchenProfile;
import com.nanaskitchens.api.kitchens.dto.KitchenSearchResult;
import com.nanaskitchens.api.kitchens.dto.MenuDayResponse;
import com.nanaskitchens.api.kitchens.dto.UpdateKitchenRequest;
import com.nanaskitchens.api.storage.PhotoStorage;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
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
 * Ported from apps/api/src/kitchens (Story 1.3). Works directly on the Prisma-managed tables
 * via SQL — same approach the NestJS service used for the PostGIS parts.
 */
@Service
public class KitchensService {

    /** Mirrors CUISINE_TAGS in packages/core. */
    static final Set<String> CUISINE_TAGS = Set.of(
            "turkish", "chinese", "mexican", "indian", "italian", "japanese", "korean",
            "vietnamese", "lebanese", "ethiopian", "persian", "greek", "thai", "other");

    static final double SEARCH_RADIUS_MILES = 10;
    static final double METERS_PER_MILE = 1609.344;

    /** Story 1.3 AC2 — ≤10 photos per kitchen, jpeg/png/webp, ≤5 MB each. */
    static final int MAX_PHOTOS = 10;
    static final long MAX_PHOTO_BYTES = 5 * 1024 * 1024;

    private final JdbcClient db;
    private final AddressCrypto addressCrypto;
    private final AuditLogRepository auditLogRepository;
    private final JsonMapper jsonMapper;
    private final GeocodingService geocoding;
    private final PhotoStorage photoStorage;

    public KitchensService(
            JdbcClient db,
            AddressCrypto addressCrypto,
            AuditLogRepository auditLogRepository,
            JsonMapper jsonMapper,
            GeocodingService geocoding,
            PhotoStorage photoStorage) {
        this.db = db;
        this.addressCrypto = addressCrypto;
        this.auditLogRepository = auditLogRepository;
        this.jsonMapper = jsonMapper;
        this.geocoding = geocoding;
        this.photoStorage = photoStorage;
    }

    @Transactional
    public KitchenProfile create(String sellerId, CreateKitchenRequest input) {
        if (!CUISINE_TAGS.contains(input.cuisineTag())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "INVALID_CUISINE");
        }
        double[] point = resolvePoint(input.address(), input.lat(), input.lng());
        String id = UUID.randomUUID().toString();
        db.sql("""
                INSERT INTO "Kitchen" (id, "sellerId", name, "cuisineTag", description, photos, "addressEncrypted")
                VALUES (:id, :sellerId, :name, :cuisineTag, :description, '{}'::text[], :addressEncrypted)
                """)
                .param("id", id)
                .param("sellerId", sellerId)
                .param("name", input.name())
                .param("cuisineTag", input.cuisineTag())
                .param("description", input.description())
                .param("addressEncrypted", addressCrypto.encrypt(input.address())) // NFR5
                .update();
        updateGeo(id, point);
        return publicProfile(id);
    }

    /** Story 1.3 — PATCH: sellers edit only their kitchen; a new address re-geocodes. */
    @Transactional
    public KitchenProfile update(String sellerId, String kitchenId, UpdateKitchenRequest input) {
        String ownerId = db.sql("SELECT \"sellerId\" FROM \"Kitchen\" WHERE id = :id")
                .param("id", kitchenId)
                .query(String.class)
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!ownerId.equals(sellerId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        if (input.cuisineTag() != null && !CUISINE_TAGS.contains(input.cuisineTag())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_CUISINE");
        }

        if (input.name() != null) {
            db.sql("UPDATE \"Kitchen\" SET name = :v WHERE id = :id")
                    .param("v", input.name()).param("id", kitchenId).update();
        }
        if (input.cuisineTag() != null) {
            db.sql("UPDATE \"Kitchen\" SET \"cuisineTag\" = :v WHERE id = :id")
                    .param("v", input.cuisineTag()).param("id", kitchenId).update();
        }
        if (input.description() != null) {
            db.sql("UPDATE \"Kitchen\" SET description = :v WHERE id = :id")
                    .param("v", input.description()).param("id", kitchenId).update();
        }
        if (input.photos() != null) {
            db.sql("UPDATE \"Kitchen\" SET photos = :v WHERE id = :id")
                    .param("v", input.photos().toArray(String[]::new)).param("id", kitchenId).update();
        }
        if (input.address() != null && !input.address().isBlank()) {
            double[] point = resolvePoint(input.address(), input.lat(), input.lng());
            db.sql("UPDATE \"Kitchen\" SET \"addressEncrypted\" = :v WHERE id = :id")
                    .param("v", addressCrypto.encrypt(input.address())).param("id", kitchenId).update();
            updateGeo(kitchenId, point);
        }

        AuditLog log = new AuditLog();
        log.setActor(sellerId);
        log.setEntity("Kitchen:" + kitchenId);
        log.setAction("update_profile");
        auditLogRepository.save(log);
        return publicProfile(kitchenId);
    }

    /** Story 1.3 AC2 — upload one photo; append to the gallery via PhotoStorage. */
    @Transactional
    public KitchenProfile addPhoto(String sellerId, String kitchenId, byte[] bytes, String contentType) {
        record Row(String sellerId, int photoCount) {
        }
        Row kitchen = db.sql("SELECT \"sellerId\", cardinality(photos) AS c FROM \"Kitchen\" WHERE id = :id")
                .param("id", kitchenId)
                .query((rs, n) -> new Row(rs.getString("sellerId"), rs.getInt("c")))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!kitchen.sellerId().equals(sellerId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        if (kitchen.photoCount() >= MAX_PHOTOS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TOO_MANY_PHOTOS");
        }
        if (bytes.length == 0 || bytes.length > MAX_PHOTO_BYTES) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PHOTO_TOO_LARGE");
        }
        String url = photoStorage.store(bytes, contentType);
        db.sql("UPDATE \"Kitchen\" SET photos = array_append(photos, :url) WHERE id = :id")
                .param("url", url)
                .param("id", kitchenId)
                .update();
        return publicProfile(kitchenId);
    }

    /** AC1/AC4: geocode the address; manual lat/lng win when supplied, 400 when neither works. */
    private double[] resolvePoint(String address, Double lat, Double lng) {
        if (lat != null && lng != null) {
            return new double[] {lat, lng};
        }
        return geocoding.geocode(address)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "GEOCODING_FAILED"));
    }

    private void updateGeo(String kitchenId, double[] point) {
        db.sql("""
                UPDATE "Kitchen" SET geo = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography WHERE id = :id
                """)
                .param("lng", point[1])
                .param("lat", point[0])
                .param("id", kitchenId)
                .update();
    }

    /**
     * Chat-agent affordance: accepts either a kitchen UUID or a kitchen name (case-insensitive,
     * partial ok) and returns the UUID. Tool calls arrive with names when the UUID from an
     * earlier conversation turn is no longer in the model's context.
     */
    public String resolveKitchenId(String idOrName) {
        if (idOrName == null) {
            return null;
        }
        String v = idOrName.trim();
        if (v.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")) {
            return v;
        }
        return db.sql("""
                SELECT id FROM "Kitchen" WHERE name ILIKE :name ORDER BY LENGTH(name) ASC LIMIT 1
                """)
                .param("name", "%" + v + "%")
                .query((rs, n) -> rs.getString("id"))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "KITCHEN_NOT_FOUND:" + v));
    }

    /** FR5 + NFR2: PostGIS search within a 10-mile radius, ordered by distance. */
    public List<KitchenSearchResult> search(double lat, double lng, String cuisine) {
        double radiusMeters = SEARCH_RADIUS_MILES * METERS_PER_MILE;
        return db.sql("""
                SELECT k.id, k.name, k."cuisineTag", k.description, k."ratingAvg", k."ratingCount",
                       k."hygieneScoreTotal" AS hygiene,
                       ST_Distance(k.geo, ST_SetSRID(ST_MakePoint(:lng, :lat),4326)::geography) AS meters,
                       COALESCE((
                         SELECT SUM(mi."portionsRemaining") FROM "MenuItem" mi
                         JOIN "MenuDay" md ON md.id = mi."menuDayId"
                         WHERE md."kitchenId" = k.id AND md.status = 'published'
                           AND md.date = (now() AT TIME ZONE 'UTC')::date
                       ), 0)::int AS portions_left,
                       COALESCE(k.photos[1], (
                         SELECT d.photo FROM "MenuDay" md
                         JOIN "MenuItem" mi ON mi."menuDayId" = md.id
                         JOIN "Dish" d ON d.id = mi."dishId"
                         WHERE md."kitchenId" = k.id AND d.photo IS NOT NULL
                         ORDER BY md.date DESC LIMIT 1
                       )) AS photo
                FROM "Kitchen" k
                WHERE k."complianceAttestedAt" IS NOT NULL
                  AND k.geo IS NOT NULL
                  AND ST_DWithin(k.geo, ST_SetSRID(ST_MakePoint(:lng, :lat),4326)::geography, :radius)
                  AND (:cuisine::text IS NULL OR k."cuisineTag" = LOWER(:cuisine))
                ORDER BY meters ASC
                LIMIT 50
                """)
                .param("lat", lat)
                .param("lng", lng)
                .param("radius", radiusMeters)
                .param("cuisine", cuisine, Types.VARCHAR)
                .query((rs, rowNum) -> new KitchenSearchResult(
                        rs.getString("id"),
                        rs.getString("name"),
                        rs.getString("cuisineTag"),
                        Math.round(rs.getDouble("meters") / METERS_PER_MILE * 10) / 10.0,
                        rs.getObject("ratingAvg", Double.class),
                        rs.getInt("ratingCount"),
                        rs.getObject("hygiene", Integer.class),
                        rs.getInt("portions_left"),
                        rs.getString("photo"),
                        rs.getString("description")))
                .list();
    }

    /** Resolves a city or postal code before using the same canonical nearby-kitchen search. */
    public List<KitchenSearchResult> searchByLocation(String location, String cuisine) {
        if (location == null || location.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "LOCATION_REQUIRED");
        }
        String query = location.trim();
        // A postal code alone is ambiguous outside the US; in this demo it is a US marketplace.
        if (query.matches("\\d{5}(-\\d{4})?")) {
            query += ", USA";
        }
        double[] point = geocoding.geocode(query)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "LOCATION_NOT_FOUND"));
        return search(point[0], point[1], cuisine);
    }

    /** The street address NEVER leaves this serializer (FR10 / Story 1.3 AC3). */
    public KitchenProfile publicProfile(String id) {
        return db.sql("""
                SELECT id, name, "cuisineTag", description, photos, "ratingAvg", "ratingCount",
                       "hygieneScoreTotal", "hygieneScoredAt", "complianceAttestedAt"
                FROM "Kitchen" WHERE id = :id
                """)
                .param("id", id)
                .query((rs, rowNum) -> new KitchenProfile(
                        rs.getString("id"),
                        rs.getString("name"),
                        rs.getString("cuisineTag"),
                        rs.getString("description"),
                        stringList(rs, "photos"),
                        rs.getObject("ratingAvg", Double.class),
                        rs.getInt("ratingCount"),
                        rs.getObject("hygieneScoreTotal", Integer.class),
                        localDateTime(rs, "hygieneScoredAt"),
                        localDateTime(rs, "complianceAttestedAt")))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    /** The seller's own kitchen (404 while onboarding isn't done). Same public shape — FR10 still holds. */
    public KitchenProfile sellerKitchen(String sellerId) {
        String kitchenId = db.sql("SELECT id FROM \"Kitchen\" WHERE \"sellerId\" = :sellerId")
                .param("sellerId", sellerId)
                .query(String.class)
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "NO_KITCHEN"));
        return publicProfile(kitchenId);
    }

    /** Story 5.1 / get_menu: the dated published menu of a kitchen, or null. */
    public MenuDayResponse publishedMenu(String kitchenId, String date) {
        LocalDate day;
        if (date != null && !date.isBlank()) {
            try {
                day = LocalDate.parse(date.length() > 10 ? date.substring(0, 10) : date);
            } catch (java.time.format.DateTimeParseException e) {
                // This is a public endpoint: a malformed ?date= is the caller's mistake, so it
                // has to answer 400. Left unguarded the parse exception escaped as a 500.
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "INVALID_DATE: expected an ISO date (YYYY-MM-DD)");
            }
        } else {
            day = LocalDate.now(ZoneOffset.UTC);
        }
        List<Map<String, Object>> rows = db.sql("""
                SELECT md.id, md."kitchenId", md.date, md.status::text AS status,
                       md."readyWindows"::text AS ready_windows,
                       mi.id AS item_id, mi."dishId", mi."portionsTotal", mi."portionsRemaining",
                       d.name AS dish_name, d.description AS dish_description, d.photo AS dish_photo,
                       d.calories AS dish_calories,
                       d."priceCents", d."dietaryTags", d."kitchenId" AS dish_kitchen_id
                FROM "MenuDay" md
                LEFT JOIN "MenuItem" mi ON mi."menuDayId" = md.id
                LEFT JOIN "Dish" d ON d.id = mi."dishId"
                WHERE md."kitchenId" = :kitchenId AND md.status = 'published' AND md.date = :date
                """)
                .param("kitchenId", kitchenId)
                .param("date", day)
                .query((rs, rowNum) -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", rs.getString("id"));
                    row.put("kitchenId", rs.getString("kitchenId"));
                    row.put("date", rs.getDate("date").toLocalDate());
                    row.put("status", rs.getString("status"));
                    row.put("readyWindows", rs.getString("ready_windows"));
                    String itemId = rs.getString("item_id");
                    if (itemId != null) {
                        row.put("item", new MenuDayResponse.Item(
                                itemId,
                                rs.getString("id"),
                                rs.getString("dishId"),
                                rs.getInt("portionsTotal"),
                                rs.getInt("portionsRemaining"),
                                new MenuDayResponse.Dish(
                                        rs.getString("dishId"),
                                        rs.getString("dish_kitchen_id"),
                                        rs.getString("dish_name"),
                                        rs.getString("dish_description"),
                                        rs.getString("dish_photo"),
                                        rs.getObject("dish_calories", Integer.class),
                                        rs.getInt("priceCents"),
                                        stringList(rs, "dietaryTags"))));
                    }
                    return row;
                })
                .list();
        if (rows.isEmpty()) {
            return null;
        }
        Map<String, Object> first = rows.getFirst();
        List<MenuDayResponse.Item> items = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            if (row.get("item") != null) {
                items.add((MenuDayResponse.Item) row.get("item"));
            }
        }
        return new MenuDayResponse(
                (String) first.get("id"),
                (String) first.get("kitchenId"),
                (LocalDate) first.get("date"),
                (String) first.get("status"),
                jsonMapper.readTree((String) first.get("readyWindows")),
                items);
    }

    @Transactional
    public Map<String, Object> attest(String sellerId, String kitchenId, String ip) {
        String ownerId = db.sql("SELECT \"sellerId\" FROM \"Kitchen\" WHERE id = :id")
                .param("id", kitchenId)
                .query(String.class)
                .optional()
                .orElse(null);
        if (ownerId == null || !ownerId.equals(sellerId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        db.sql("""
                UPDATE "Kitchen" SET "complianceAttestedAt" = now(), "attestationIp" = :ip WHERE id = :id
                """)
                .param("ip", ip)
                .param("id", kitchenId)
                .update();
        AuditLog log = new AuditLog();
        log.setActor(sellerId);
        log.setEntity("Kitchen:" + kitchenId);
        log.setAction("attest_compliance");
        auditLogRepository.save(log);
        return Map.of("attested", true);
    }

    private static List<String> stringList(ResultSet rs, String column) throws SQLException {
        java.sql.Array array = rs.getArray(column);
        return array == null ? List.of() : Arrays.asList((String[]) array.getArray());
    }

    private static LocalDateTime localDateTime(ResultSet rs, String column) throws SQLException {
        Timestamp ts = rs.getTimestamp(column);
        return ts == null ? null : ts.toLocalDateTime();
    }
}
