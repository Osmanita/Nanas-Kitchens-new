package com.nanaskitchens.api.support;

import com.nanaskitchens.api.kitchens.AddressCrypto;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;

/** Minimal raw-SQL fixture builders for integration tests — mirrors the columns the app's
 * own seed script (apps/api/prisma/seed.ts) writes, kept intentionally small (just what
 * OrdersService/KitchensService actually read). */
public final class TestData {

    // Kitchen.addressEncrypted has to hold real ciphertext, not a placeholder: OrdersService
    // .detail() discloses the pickup address on any confirmed pickup order, and decrypting a
    // literal blows up with ADDRESS_DECRYPT_FAILED before a single assertion runs.
    private static final AddressCrypto CRYPTO = new AddressCrypto(IntegrationTest.ADDRESS_ENC_KEY);

    public static final String KITCHEN_ADDRESS = "1 Kitchen Way, Powell, OH 43065";

    private TestData() {
    }

    public static String insertUser(JdbcClient db, String role, String email) {
        String id = UUID.randomUUID().toString();
        db.sql("""
                INSERT INTO "User" (id, role, email, "passwordHash")
                VALUES (:id, :role, :email, 'not-a-real-hash')
                """)
                .param("id", id)
                .param("role", role)
                .param("email", email)
                .update();
        return id;
    }

    /** Kitchen + geo point, attested so search/order flows treat it as live. */
    public static String insertKitchen(JdbcClient db, String sellerId, double lat, double lng) {
        String id = UUID.randomUUID().toString();
        db.sql("""
                INSERT INTO "Kitchen"
                  (id, "sellerId", name, "cuisineTag", description, photos, "addressEncrypted",
                   "complianceAttestedAt")
                VALUES (:id, :sellerId, 'Test Kitchen', 'turkish', 'desc', '{}', :addressEncrypted, now())
                """)
                .param("id", id)
                .param("sellerId", sellerId)
                .param("addressEncrypted", CRYPTO.encrypt(KITCHEN_ADDRESS))
                .update();
        db.sql("""
                UPDATE "Kitchen" SET geo = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
                WHERE id = :id
                """)
                .param("id", id)
                .param("lat", lat)
                .param("lng", lng)
                .update();
        return id;
    }

    public static String insertDish(JdbcClient db, String kitchenId, String name, int priceCents) {
        String id = UUID.randomUUID().toString();
        db.sql("""
                INSERT INTO "Dish" (id, "kitchenId", name, description, "priceCents", "dietaryTags")
                VALUES (:id, :kitchenId, :name, 'desc', :priceCents, '{}')
                """)
                .param("id", id)
                .param("kitchenId", kitchenId)
                .param("name", name)
                .param("priceCents", priceCents)
                .update();
        return id;
    }

    /** Published menu day for UTC "today" — matches what the daily-rollover job and the
     * kitchens/search "portionsLeftToday" query both key off. */
    public static String insertMenuDayToday(JdbcClient db, String kitchenId) {
        String id = UUID.randomUUID().toString();
        db.sql("""
                INSERT INTO "MenuDay" (id, "kitchenId", date, status, "readyWindows")
                VALUES (:id, :kitchenId, (now() AT TIME ZONE 'UTC')::date, 'published',
                        '[{"start":"17:00","end":"20:00","slotMinutes":30}]'::jsonb)
                """)
                .param("id", id)
                .param("kitchenId", kitchenId)
                .update();
        return id;
    }

    public static String insertMenuItem(JdbcClient db, String menuDayId, String dishId, int portions) {
        String id = UUID.randomUUID().toString();
        db.sql("""
                INSERT INTO "MenuItem" (id, "menuDayId", "dishId", "portionsTotal", "portionsRemaining")
                VALUES (:id, :menuDayId, :dishId, :portions, :portions)
                """)
                .param("id", id)
                .param("menuDayId", menuDayId)
                .param("dishId", dishId)
                .param("portions", portions)
                .update();
        return id;
    }
}
