package com.nanaskitchens.api.orders;

import static org.assertj.core.api.Assertions.assertThat;

import com.nanaskitchens.api.orders.dto.CreateOrderRequest;
import com.nanaskitchens.api.orders.dto.OrderDetailResponse;
import com.nanaskitchens.api.support.IntegrationTest;
import com.nanaskitchens.api.support.TestData;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.server.ResponseStatusException;

/**
 * End to end through the real database: place() writes the Order row and decrements
 * inventory in one transaction (Story 2.3 / 3.3). Pickup only — delivery would hit the
 * real Nominatim geocoder over the network, which has no place in a test suite.
 */
class OrdersServiceIntegrationTest extends IntegrationTest {

    @Autowired
    private OrdersService ordersService;

    @Autowired
    private JdbcClient db;

    private record Fixture(String buyerId, String kitchenId, String menuDayId, String menuItemId) {
    }

    private Fixture seedKitchenWithOneDish(int priceCents, int portions) {
        String sellerId = TestData.insertUser(db, "seller", "seller-" + UUID.randomUUID() + "@test.dev");
        String buyerId = TestData.insertUser(db, "buyer", "buyer-" + UUID.randomUUID() + "@test.dev");
        String kitchenId = TestData.insertKitchen(db, sellerId, 40.1578, -83.0752);
        String dishId = TestData.insertDish(db, kitchenId, "Manti", priceCents);
        String menuDayId = TestData.insertMenuDayToday(db, kitchenId);
        String menuItemId = TestData.insertMenuItem(db, menuDayId, dishId, portions);
        return new Fixture(buyerId, kitchenId, menuDayId, menuItemId);
    }

    @Test
    void placingAConfirmedPickupOrderChargesTheRightTotalsAndDecrementsInventory() {
        Fixture f = seedKitchenWithOneDish(1200, 10);

        CreateOrderRequest request = new CreateOrderRequest(
                f.kitchenId(), f.menuDayId(),
                List.of(new CreateOrderRequest.Item(f.menuItemId(), 2)),
                "2026-08-05T18:00:00Z", "pickup", null, 0, true);

        Map<String, Object> result = ordersService.place(f.buyerId(), request);

        assertThat(result.get("confirmed")).isEqualTo(true);
        OrderDetailResponse orderDetail = (OrderDetailResponse) result.get("order");
        String orderId = orderDetail.id();
        assertThat(orderId).isNotBlank();
        assertThat(orderDetail.status()).isEqualTo("confirmed"); // mock payment settles instantly

        Map<String, Object> order = db.sql("""
                SELECT status, "totalCents", "commissionCents", "deliveryFeeCents", "tipCents"
                FROM "Order" WHERE id = :id
                """)
                .param("id", orderId)
                .query((rs, n) -> {
                    Map<String, Object> row = new java.util.LinkedHashMap<>();
                    row.put("status", rs.getString("status"));
                    row.put("totalCents", rs.getInt("totalCents"));
                    row.put("commissionCents", rs.getInt("commissionCents"));
                    row.put("deliveryFeeCents", rs.getInt("deliveryFeeCents"));
                    row.put("tipCents", rs.getInt("tipCents"));
                    return row;
                })
                .single();

        // 2 x $12.00 food, no delivery fee/tip on pickup, 15% commission on food subtotal.
        assertThat(order.get("totalCents")).isEqualTo(2400);
        assertThat(order.get("commissionCents")).isEqualTo(360);
        assertThat(order.get("deliveryFeeCents")).isEqualTo(0);
        assertThat(order.get("tipCents")).isEqualTo(0);
        assertThat(order.get("status")).isEqualTo("confirmed"); // mock payment settles instantly

        Integer remaining = db.sql("SELECT \"portionsRemaining\" FROM \"MenuItem\" WHERE id = :id")
                .param("id", f.menuItemId())
                .query(Integer.class)
                .single();
        assertThat(remaining).isEqualTo(8); // 10 - 2
    }

    @Test
    void unconfirmedRequestReturnsAPricedSummaryWithoutTouchingInventoryOrCreatingAnOrder() {
        Fixture f = seedKitchenWithOneDish(1000, 5);

        CreateOrderRequest request = new CreateOrderRequest(
                f.kitchenId(), f.menuDayId(),
                List.of(new CreateOrderRequest.Item(f.menuItemId(), 1)),
                "2026-08-05T18:00:00Z", "pickup", null, 0, false);

        Map<String, Object> result = ordersService.place(f.buyerId(), request);

        assertThat(result.get("confirmed")).isEqualTo(false);
        assertThat(result).containsKey("summary");

        Integer remaining = db.sql("SELECT \"portionsRemaining\" FROM \"MenuItem\" WHERE id = :id")
                .param("id", f.menuItemId())
                .query(Integer.class)
                .single();
        assertThat(remaining).isEqualTo(5); // untouched — only confirm=true has side effects

        Long orderCount = db.sql("SELECT COUNT(*) FROM \"Order\" WHERE \"menuDayId\" = :menuDayId")
                .param("menuDayId", f.menuDayId())
                .query(Long.class)
                .single();
        assertThat(orderCount).isZero();
    }

    @Test
    void orderingMorePortionsThanAvailableIsRejected() {
        Fixture f = seedKitchenWithOneDish(1000, 1);

        CreateOrderRequest request = new CreateOrderRequest(
                f.kitchenId(), f.menuDayId(),
                List.of(new CreateOrderRequest.Item(f.menuItemId(), 5)),
                "2026-08-05T18:00:00Z", "pickup", null, 0, true);

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> ordersService.place(f.buyerId(), request))
                .isInstanceOf(ResponseStatusException.class);

        Integer remaining = db.sql("SELECT \"portionsRemaining\" FROM \"MenuItem\" WHERE id = :id")
                .param("id", f.menuItemId())
                .query(Integer.class)
                .single();
        assertThat(remaining).isEqualTo(1); // rejected atomically — nothing decremented
    }
}
