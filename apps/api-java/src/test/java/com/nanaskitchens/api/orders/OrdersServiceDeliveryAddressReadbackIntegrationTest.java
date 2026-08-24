package com.nanaskitchens.api.orders;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.nanaskitchens.api.delivery.GeocodingService;
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
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.server.ResponseStatusException;

/**
 * The sibling test asserts the drop-off address is WRITTEN. This one asserts it is READ, which
 * for a long time it was not: {@code deliveryAddressEncrypted} appeared in three INSERT
 * statements and in no SELECT anywhere, so a buyer could place a delivery order that neither
 * the seller nor the courier could ever see an address for. A "not null in the database" test
 * passes happily in that world — the assertions here are on what the seller's board hands back.
 *
 * <p>Also covers the two guards that used to fail open on this path: a kitchen with no PostGIS
 * point silently skipped the radius check, and constraints declared on CreateOrderRequest were
 * only enforced by the controller's {@code @Valid}, so callers reaching place() directly (the
 * chat agent's createOrder tool) went straight past them.
 */
class OrdersServiceDeliveryAddressReadbackIntegrationTest extends IntegrationTest {

    private static final double KITCHEN_LAT = 40.1578;
    private static final double KITCHEN_LNG = -83.0752;
    private static final String DELIVERY_ADDRESS = "123 Grandview Ave, Powell, OH 43065";

    @Autowired
    private OrdersService ordersService;

    @Autowired
    private JdbcClient db;

    @MockitoBean
    private GeocodingService geocoding;

    private record Fixture(String sellerId, String buyerId, String kitchenId, String menuDayId,
            String menuItemId) {
    }

    private Fixture seedKitchenWithOneDish() {
        String sellerId = TestData.insertUser(db, "seller", "seller-" + UUID.randomUUID() + "@test.dev");
        String buyerId = TestData.insertUser(db, "buyer", "buyer-" + UUID.randomUUID() + "@test.dev");
        String kitchenId = TestData.insertKitchen(db, sellerId, KITCHEN_LAT, KITCHEN_LNG);
        String dishId = TestData.insertDish(db, kitchenId, "Manti", 1200);
        String menuDayId = TestData.insertMenuDayToday(db, kitchenId);
        String menuItemId = TestData.insertMenuItem(db, menuDayId, dishId, 10);
        return new Fixture(sellerId, buyerId, kitchenId, menuDayId, menuItemId);
    }

    private CreateOrderRequest order(Fixture f, String fulfillment, String address, Integer tipCents) {
        return new CreateOrderRequest(
                f.kitchenId(), f.menuDayId(),
                List.of(new CreateOrderRequest.Item(f.menuItemId(), 1)),
                "2026-08-05T18:00:00Z", fulfillment, address, tipCents, true);
    }

    /** Half a mile north of the kitchen: inside the radius and inside the US. */
    private void stubNearbyGeocode(String address) {
        when(geocoding.geocode(address))
                .thenReturn(new GeocodingService.Point(KITCHEN_LAT + 0.008, KITCHEN_LNG, "us"));
    }

    private String placeDeliveryOrder(Fixture f) {
        stubNearbyGeocode(DELIVERY_ADDRESS);
        Map<String, Object> result =
                ordersService.place(f.buyerId(), order(f, "delivery", DELIVERY_ADDRESS, 200));
        return ((OrderDetailResponse) result.get("order")).id();
    }

    private Map<String, Object> boardRow(Fixture f, String orderId) {
        return ordersService.listForKitchen(f.sellerId(), f.kitchenId(), null).stream()
                .filter(row -> orderId.equals(row.get("id")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("order " + orderId + " missing from the board"));
    }

    @Test
    void sellerSeesTheDropOffAddressOnceTheOrderIsAccepted() {
        Fixture f = seedKitchenWithOneDish();
        String orderId = placeDeliveryOrder(f);

        // Before the seller takes the order there is no reason to hand them a home address.
        assertThat(boardRow(f, orderId).get("deliveryAddress")).isNull();

        ordersService.transition(f.sellerId(), orderId, "accepted");

        // The plaintext address, not the ciphertext and not the kitchen's own address.
        assertThat(boardRow(f, orderId).get("deliveryAddress")).isEqualTo(DELIVERY_ADDRESS);
    }

    @Test
    void aDeclinedOrderStopsDisclosingTheAddressAgain() {
        Fixture f = seedKitchenWithOneDish();
        String orderId = placeDeliveryOrder(f);

        ordersService.transition(f.sellerId(), orderId, "declined");

        assertThat(boardRow(f, orderId).get("deliveryAddress")).isNull();
    }

    @Test
    void pickupOrdersNeverCarryADropOffAddress() {
        Fixture f = seedKitchenWithOneDish();
        Map<String, Object> result = ordersService.place(f.buyerId(), order(f, "pickup", null, 0));
        String orderId = ((OrderDetailResponse) result.get("order")).id();

        ordersService.transition(f.sellerId(), orderId, "accepted");

        assertThat(boardRow(f, orderId).get("deliveryAddress")).isNull();
    }

    @Test
    void aKitchenWithNoMapPointRejectsDeliveryInsteadOfSkippingTheRadiusCheck() {
        Fixture f = seedKitchenWithOneDish();
        db.sql("UPDATE \"Kitchen\" SET geo = NULL WHERE id = :id").param("id", f.kitchenId()).update();
        // Deliberately a point 14 miles away: if the guard regressed to "no row means no check",
        // this order would be accepted even though it is far outside the radius.
        when(geocoding.geocode(DELIVERY_ADDRESS))
                .thenReturn(new GeocodingService.Point(39.9612, -82.9988, "us"));

        assertThatThrownBy(
                        () -> ordersService.place(f.buyerId(), order(f, "delivery", DELIVERY_ADDRESS, 0)))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("KITCHEN_NOT_GEOCODED");
    }

    @Test
    void placeEnforcesTheRequestConstraintsForCallersThatBypassTheController() {
        Fixture f = seedKitchenWithOneDish();
        stubNearbyGeocode(DELIVERY_ADDRESS);

        // A negative courier tip would otherwise be subtracted straight off the order total.
        assertThatThrownBy(
                        () -> ordersService.place(f.buyerId(), order(f, "delivery", DELIVERY_ADDRESS, -500)))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("INVALID_ORDER");

        // And "teleport" is not a fulfillment mode; @Pattern only ever ran on the REST path.
        assertThatThrownBy(() -> ordersService.place(f.buyerId(), order(f, "teleport", null, 0)))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("INVALID_ORDER");

        assertThat(db.sql("SELECT COUNT(*) FROM \"Order\" WHERE \"buyerId\" = :b")
                        .param("b", f.buyerId())
                        .query(Long.class)
                        .single())
                .isZero();
    }
}
