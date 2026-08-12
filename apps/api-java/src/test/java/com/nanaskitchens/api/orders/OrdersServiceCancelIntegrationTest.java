package com.nanaskitchens.api.orders;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nanaskitchens.api.orders.dto.CreateOrderRequest;
import com.nanaskitchens.api.orders.dto.OrderDetailResponse;
import com.nanaskitchens.api.support.IntegrationTest;
import com.nanaskitchens.api.support.TestData;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.server.ResponseStatusException;

/**
 * Guards the cancel window: cancelling releases the portions and refunds in full, so it may
 * only run before the kitchen has spent anything on the order. Cancel used to reject just the
 * three final statuses, which let a buyer cancel an order that was already accepted, being
 * cooked, or plated and waiting for the courier — portions that no longer exist went back on
 * sale and the buyer got the whole payment back.
 *
 * <p>Pickup only — delivery would hit the real Nominatim geocoder over the network, which has
 * no place in a test suite.
 */
class OrdersServiceCancelIntegrationTest extends IntegrationTest {

    @Autowired
    private OrdersService ordersService;

    @Autowired
    private JdbcClient db;

    private record Fixture(String sellerId, String buyerId, String kitchenId, String menuDayId,
            String menuItemId) {
    }

    private Fixture seedKitchenWithOneDish(int priceCents, int portions) {
        String sellerId = TestData.insertUser(db, "seller", "seller-" + UUID.randomUUID() + "@test.dev");
        String buyerId = TestData.insertUser(db, "buyer", "buyer-" + UUID.randomUUID() + "@test.dev");
        String kitchenId = TestData.insertKitchen(db, sellerId, 40.1578, -83.0752);
        String dishId = TestData.insertDish(db, kitchenId, "Manti", priceCents);
        String menuDayId = TestData.insertMenuDayToday(db, kitchenId);
        String menuItemId = TestData.insertMenuItem(db, menuDayId, dishId, portions);
        return new Fixture(sellerId, buyerId, kitchenId, menuDayId, menuItemId);
    }

    /** The mock payment provider settles instantly, so this lands the order in 'confirmed'. */
    private String placeConfirmedPickupOrder(Fixture f, String buyerId, int qty) {
        CreateOrderRequest request = new CreateOrderRequest(
                f.kitchenId(), f.menuDayId(),
                List.of(new CreateOrderRequest.Item(f.menuItemId(), qty)),
                "2026-08-05T18:00:00Z", "pickup", null, 0, true);
        Map<String, Object> result = ordersService.place(buyerId, request);
        OrderDetailResponse order = (OrderDetailResponse) result.get("order");
        assertThat(order.status()).isEqualTo("confirmed");
        return order.id();
    }

    private String statusOf(String orderId) {
        return db.sql("SELECT status FROM \"Order\" WHERE id = :id")
                .param("id", orderId)
                .query(String.class)
                .single();
    }

    private int portionsRemaining(String menuItemId) {
        return db.sql("SELECT \"portionsRemaining\" FROM \"MenuItem\" WHERE id = :id")
                .param("id", menuItemId)
                .query(Integer.class)
                .single();
    }

    @Test
    void cancellingAConfirmedOrderReleasesItsPortions() {
        Fixture f = seedKitchenWithOneDish(1200, 10);
        String orderId = placeConfirmedPickupOrder(f, f.buyerId(), 2);
        assertThat(portionsRemaining(f.menuItemId())).isEqualTo(8);

        Map<String, Object> cancelled = ordersService.cancel(f.buyerId(), orderId);

        assertThat(cancelled.get("status")).isEqualTo("cancelled");
        assertThat(statusOf(orderId)).isEqualTo("cancelled");
        assertThat(portionsRemaining(f.menuItemId())).isEqualTo(10); // back to the pre-order stock
    }

    @Test
    void cancellingAnAcceptedOrderIsRejectedAndLeavesTheStockAlone() {
        Fixture f = seedKitchenWithOneDish(1200, 10);
        String orderId = placeConfirmedPickupOrder(f, f.buyerId(), 2);
        ordersService.transition(f.sellerId(), orderId, "accepted");

        assertThatThrownBy(() -> ordersService.cancel(f.buyerId(), orderId))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> {
                    assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(ex.getReason()).isEqualTo("NOT_CANCELLABLE");
                });

        assertThat(statusOf(orderId)).isEqualTo("accepted");
        // The point of the fix: the kitchen committed these portions the moment it accepted,
        // so they must not reappear as available stock.
        assertThat(portionsRemaining(f.menuItemId())).isEqualTo(8);
    }

    @Test
    void cancellingAReadyOrderIsRejectedAndLeavesTheStockAlone() {
        Fixture f = seedKitchenWithOneDish(1200, 10);
        String orderId = placeConfirmedPickupOrder(f, f.buyerId(), 3);
        // The worst case the old code allowed: the food is cooked and waiting to go out.
        ordersService.transition(f.sellerId(), orderId, "accepted");
        ordersService.transition(f.sellerId(), orderId, "preparing");
        ordersService.transition(f.sellerId(), orderId, "ready");

        assertThatThrownBy(() -> ordersService.cancel(f.buyerId(), orderId))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> {
                    assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(ex.getReason()).isEqualTo("NOT_CANCELLABLE");
                });

        assertThat(statusOf(orderId)).isEqualTo("ready");
        assertThat(portionsRemaining(f.menuItemId())).isEqualTo(7);
    }

    @Test
    void aDeclinedOrderCannotAlsoBeCancelled() {
        Fixture f = seedKitchenWithOneDish(1200, 10);
        // A second buyer holds portions of the same menu item so the restore below stays under
        // portionsTotal — inventory.restore() caps there, which would hide a double restore.
        String otherBuyerId = TestData.insertUser(db, "buyer", "buyer-" + UUID.randomUUID() + "@test.dev");
        placeConfirmedPickupOrder(f, otherBuyerId, 3);
        String orderId = placeConfirmedPickupOrder(f, f.buyerId(), 2);
        assertThat(portionsRemaining(f.menuItemId())).isEqualTo(5);

        ordersService.transition(f.sellerId(), orderId, "declined"); // restores + refunds already

        assertThatThrownBy(() -> ordersService.cancel(f.buyerId(), orderId))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> {
                    assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(ex.getReason()).isEqualTo("NOT_CANCELLABLE");
                });

        assertThat(statusOf(orderId)).isEqualTo("declined");
        // 5 + 2, not 5 + 2 + 2: a second pass would put phantom portions on sale and send a
        // second refund for a payment that was already returned.
        assertThat(portionsRemaining(f.menuItemId())).isEqualTo(7);
    }

    @Test
    void aBuyerCannotCancelSomeoneElsesOrder() {
        Fixture f = seedKitchenWithOneDish(1200, 10);
        String orderId = placeConfirmedPickupOrder(f, f.buyerId(), 2);
        String strangerId = TestData.insertUser(db, "buyer", "buyer-" + UUID.randomUUID() + "@test.dev");

        assertThatThrownBy(() -> ordersService.cancel(strangerId, orderId))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN));

        assertThat(statusOf(orderId)).isEqualTo("confirmed");
        assertThat(portionsRemaining(f.menuItemId())).isEqualTo(8);
    }
}
