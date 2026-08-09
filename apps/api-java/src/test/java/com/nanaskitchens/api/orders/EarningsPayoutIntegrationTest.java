package com.nanaskitchens.api.orders;

import static org.assertj.core.api.Assertions.assertThat;

import com.nanaskitchens.api.support.IntegrationTest;
import com.nanaskitchens.api.support.TestData;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * Guards the only payout formula in the codebase (EarningsController). The kitchen is paid for the
 * FOOD alone: the courier's $3.99 delivery fee and the courier tip ride along inside
 * Order.totalCents but are the courier's money, and the 15% commission has always been charged on
 * the food subtotal only. A regression that folds either back into "gross" pays the seller money
 * the platform never took commission on and breaks the seller screen's "gross − commission = net"
 * arithmetic. Stripe Connect will move real money through these three formulas.
 *
 * <p>Orders are inserted with raw SQL instead of placed through OrdersService: only a delivery
 * order carries a fee and a tip, and OrdersService geocodes the delivery address against the live
 * Nominatim service, which has no business in a test suite.
 */
class EarningsPayoutIntegrationTest extends IntegrationTest {

    // Deliberately three distinguishable amounts: if a formula re-adds the fee or the tip, the
    // asserted gross/net move by 399 / 500 rather than staying accidentally equal.
    private static final int DISH_PRICE_CENTS = 1200;
    private static final int DELIVERY_FEE_CENTS = 399;
    private static final int TIP_CENTS = 500;

    // 2 x $12.00 food = 2400; commission = round(2400 * 0.15) = 360; payout = 2400 - 360 = 2040.
    // Stored totalCents is 2400 + 399 + 500 = 3299, so a broken "gross" reads 3299 (net 2939).
    private static final long FOOD_CENTS = 2400L;
    private static final int COMMISSION_CENTS = 360;
    private static final long NET_CENTS = 2040L;

    @Autowired
    private EarningsController earningsController;

    @Autowired
    private JdbcClient db;

    private record Fixture(String sellerId, String buyerId, String kitchenId, String menuDayId,
            String menuItemId) {
    }

    private Fixture seedKitchenWithOneDish() {
        String sellerId = TestData.insertUser(db, "seller", "seller-" + UUID.randomUUID() + "@test.dev");
        String buyerId = TestData.insertUser(db, "buyer", "buyer-" + UUID.randomUUID() + "@test.dev");
        String kitchenId = TestData.insertKitchen(db, sellerId, 40.1578, -83.0752);
        String dishId = TestData.insertDish(db, kitchenId, "Manti", DISH_PRICE_CENTS);
        String menuDayId = TestData.insertMenuDayToday(db, kitchenId);
        String menuItemId = TestData.insertMenuItem(db, menuDayId, dishId, 50);
        return new Fixture(sellerId, buyerId, kitchenId, menuDayId, menuItemId);
    }

    /**
     * Writes the row shape OrdersService.place() produces for a delivery order: totalCents already
     * includes the courier fee and tip, commissionCents was charged on the food alone. createdAt is
     * pinned to noon of a UTC day so the 14-day series can be asserted by index — and so a
     * CURRENT_DATE regression (JDBC session runs at UTC+3 here) would shift the row off its bucket.
     */
    private void insertDeliveryOrder(Fixture f, String status, int qty, int commissionCents, int daysAgo) {
        String orderId = UUID.randomUUID().toString();
        db.sql("""
                INSERT INTO "Order"
                  (id, "buyerId", "kitchenId", "menuDayId", status, "readySlot", fulfillment,
                   "totalCents", "commissionCents", "deliveryFeeCents", "tipCents",
                   "idempotencyKey", "createdAt")
                VALUES
                  (:id, :buyerId, :kitchenId, :menuDayId, :status,
                   (now() AT TIME ZONE 'UTC')::date + INTERVAL '18 hours', 'delivery',
                   :totalCents, :commissionCents, :deliveryFeeCents, :tipCents, :idempotencyKey,
                   (now() AT TIME ZONE 'UTC')::date - make_interval(days => :daysAgo)
                     + INTERVAL '12 hours')
                """)
                .param("id", orderId)
                .param("buyerId", f.buyerId())
                .param("kitchenId", f.kitchenId())
                .param("menuDayId", f.menuDayId())
                .param("status", status)
                .param("totalCents", qty * DISH_PRICE_CENTS + DELIVERY_FEE_CENTS + TIP_CENTS)
                .param("commissionCents", commissionCents)
                .param("deliveryFeeCents", DELIVERY_FEE_CENTS)
                .param("tipCents", TIP_CENTS)
                .param("idempotencyKey", UUID.randomUUID().toString())
                .param("daysAgo", daysAgo)
                .update();
        db.sql("""
                INSERT INTO "OrderItem" (id, "orderId", "menuItemId", "qty", "unitPriceCents")
                VALUES (:id, :orderId, :menuItemId, :qty, :unitPriceCents)
                """)
                .param("id", UUID.randomUUID().toString())
                .param("orderId", orderId)
                .param("menuItemId", f.menuItemId())
                .param("qty", qty)
                .param("unitPriceCents", DISH_PRICE_CENTS)
                .update();
    }

    /**
     * The endpoint carries a hasRole('SELLER') precondition that method security reads off the
     * holder, while the controller body compares auth.getName() with the kitchen's sellerId — so
     * both need the same token the JWT filter would have built.
     */
    private Map<String, Object> earningsAs(Fixture f) {
        Authentication auth = new UsernamePasswordAuthenticationToken(
                f.sellerId(), "raw-jwt-unused-here",
                List.of(new SimpleGrantedAuthority("ROLE_SELLER")));
        SecurityContextHolder.getContext().setAuthentication(auth);
        return earningsController.earnings(auth, f.kitchenId());
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mapAt(Map<String, Object> result, String key) {
        return (Map<String, Object>) result.get(key);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> listAt(Map<String, Object> result, String key) {
        return (List<Map<String, Object>>) result.get(key);
    }

    @Test
    void completedDeliveryOrderPaysTheKitchenForFoodOnlyNeverTheCourierFeeOrTip() {
        Fixture f = seedKitchenWithOneDish();
        insertDeliveryOrder(f, "completed", 2, COMMISSION_CENTS, 0);

        Map<String, Object> result = earningsAs(f);

        Map<String, Object> paid = mapAt(result, "paid");
        assertThat(paid.get("orders")).isEqualTo(1);
        // 3299 total − 399 fee − 500 tip = 2400 food; 2400 − 360 commission = 2040 payout.
        assertThat(paid.get("grossCents")).isEqualTo(FOOD_CENTS);
        assertThat(paid.get("commissionCents")).isEqualTo((long) COMMISSION_CENTS);
        assertThat(paid.get("netCents")).isEqualTo(NET_CENTS);

        // Same subtraction in the transactions list, which is computed in Java, not in SQL.
        List<Map<String, Object>> recent = listAt(result, "recent");
        assertThat(recent).hasSize(1);
        assertThat(recent.get(0).get("grossCents")).isEqualTo(FOOD_CENTS);
        assertThat(recent.get(0).get("commissionCents")).isEqualTo(COMMISSION_CENTS);
        assertThat(recent.get(0).get("netCents")).isEqualTo(NET_CENTS);
        assertThat(recent.get(0).get("itemsSummary")).isEqualTo("Manti x2");

        // And in the third formula, the daily chart series.
        List<Map<String, Object>> daily = listAt(result, "daily");
        assertThat(daily).hasSize(14);
        assertThat(daily.get(13).get("day")).isEqualTo(LocalDate.now(ZoneOffset.UTC).toString());
        assertThat(daily.get(13).get("netCents")).isEqualTo(NET_CENTS);

        assertThat(mapAt(result, "upcoming").get("netCents")).isEqualTo(0L);
    }

    @Test
    void orderStillInTheCookingFlowIsUpcomingMoneyAndAlsoExcludesFeeAndTip() {
        Fixture f = seedKitchenWithOneDish();
        insertDeliveryOrder(f, "preparing", 2, COMMISSION_CENTS, 0);

        Map<String, Object> result = earningsAs(f);

        Map<String, Object> upcoming = mapAt(result, "upcoming");
        assertThat(upcoming.get("orders")).isEqualTo(1);
        assertThat(upcoming.get("grossCents")).isEqualTo(FOOD_CENTS);
        assertThat(upcoming.get("commissionCents")).isEqualTo((long) COMMISSION_CENTS);
        assertThat(upcoming.get("netCents")).isEqualTo(NET_CENTS);

        // Nothing is payable until the order completes.
        assertThat(mapAt(result, "paid").get("orders")).isEqualTo(0);
        assertThat(mapAt(result, "paid").get("netCents")).isEqualTo(0L);
        assertThat(listAt(result, "recent")).isEmpty();
        assertThat(listAt(result, "daily")).allSatisfy(day -> assertThat(day.get("netCents")).isEqualTo(0L));
    }

    @Test
    void unpaidAndUndoneOrdersCountTowardsNeitherBucket() {
        Fixture f = seedKitchenWithOneDish();
        insertDeliveryOrder(f, "pending", 2, COMMISSION_CENTS, 0);
        insertDeliveryOrder(f, "declined", 2, COMMISSION_CENTS, 0);
        insertDeliveryOrder(f, "cancelled", 2, COMMISSION_CENTS, 0);

        Map<String, Object> result = earningsAs(f);

        assertThat(mapAt(result, "paid").get("orders")).isEqualTo(0);
        assertThat(mapAt(result, "paid").get("grossCents")).isEqualTo(0L);
        assertThat(mapAt(result, "upcoming").get("orders")).isEqualTo(0);
        assertThat(mapAt(result, "upcoming").get("grossCents")).isEqualTo(0L);
        assertThat(listAt(result, "recent")).isEmpty();
    }

    @Test
    void dailySeriesBucketsEachPayoutOnItsOwnUtcDay() {
        Fixture f = seedKitchenWithOneDish();
        insertDeliveryOrder(f, "completed", 2, COMMISSION_CENTS, 0);
        // 1 x $12.00 = 1200 food, commission round(1200 * 0.15) = 180, payout 1020.
        insertDeliveryOrder(f, "completed", 1, 180, 3);

        Map<String, Object> result = earningsAs(f);

        List<Map<String, Object>> daily = listAt(result, "daily");
        assertThat(daily).hasSize(14); // oldest → newest, index 13 is UTC "today"
        assertThat(daily.get(13).get("netCents")).isEqualTo(NET_CENTS);
        assertThat(daily.get(10).get("netCents")).isEqualTo(1020L);
        assertThat(daily.get(12).get("netCents")).isEqualTo(0L);
        assertThat(result.get("today")).isEqualTo(LocalDate.now(ZoneOffset.UTC).toString());

        // Both days roll up into one payable bucket: 2400 + 1200 food, 360 + 180 commission.
        Map<String, Object> paid = mapAt(result, "paid");
        assertThat(paid.get("orders")).isEqualTo(2);
        assertThat(paid.get("grossCents")).isEqualTo(3600L);
        assertThat(paid.get("commissionCents")).isEqualTo(540L);
        assertThat(paid.get("netCents")).isEqualTo(3060L);
    }
}
