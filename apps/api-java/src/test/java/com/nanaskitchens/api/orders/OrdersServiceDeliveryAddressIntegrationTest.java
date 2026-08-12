package com.nanaskitchens.api.orders;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.nanaskitchens.api.delivery.GeocodingService;
import com.nanaskitchens.api.kitchens.AddressCrypto;
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
 * Regression cover for a delivery address that was validated, geocoded, radius-checked and put
 * in the summary — and then dropped on the floor: the INSERT never wrote it, so the column the
 * courier is supposed to be dispatched to stayed null on every order ever placed. These tests
 * assert the round trip (plaintext in, ciphertext at rest, plaintext back out), because a test
 * that only checked "not null" would still pass if the column held, say, the kitchen's address.
 *
 * <p>{@link GeocodingService} — the one in the {@code delivery} package, not the same-named
 * class in {@code kitchens} — is the only thing in this flow that talks to the network
 * (Nominatim), so it is the one thing stubbed. Everything else is the real service against the
 * real schema.
 */
class OrdersServiceDeliveryAddressIntegrationTest extends IntegrationTest {

    // Powell, OH — the same point TestData-based fixtures elsewhere put the kitchen at.
    private static final double KITCHEN_LAT = 40.1578;
    private static final double KITCHEN_LNG = -83.0752;

    private static final String DELIVERY_ADDRESS = "123 Grandview Ave, Powell, OH 43065";

    @Autowired
    private OrdersService ordersService;

    @Autowired
    private AddressCrypto addressCrypto;

    @Autowired
    private JdbcClient db;

    @MockitoBean
    private GeocodingService geocoding;

    private record Fixture(String buyerId, String kitchenId, String menuDayId, String menuItemId) {
    }

    /** Local copy of the shared fixture recipe — TestData is edited by other agents in parallel. */
    private Fixture seedKitchenWithOneDish(int priceCents, int portions) {
        String sellerId = TestData.insertUser(db, "seller", "seller-" + UUID.randomUUID() + "@test.dev");
        String buyerId = TestData.insertUser(db, "buyer", "buyer-" + UUID.randomUUID() + "@test.dev");
        String kitchenId = TestData.insertKitchen(db, sellerId, KITCHEN_LAT, KITCHEN_LNG);
        String dishId = TestData.insertDish(db, kitchenId, "Manti", priceCents);
        String menuDayId = TestData.insertMenuDayToday(db, kitchenId);
        String menuItemId = TestData.insertMenuItem(db, menuDayId, dishId, portions);
        return new Fixture(buyerId, kitchenId, menuDayId, menuItemId);
    }

    private CreateOrderRequest order(Fixture f, String fulfillment, String deliveryAddress, int tipCents) {
        return new CreateOrderRequest(
                f.kitchenId(), f.menuDayId(),
                List.of(new CreateOrderRequest.Item(f.menuItemId(), 1)),
                "2026-08-05T18:00:00Z", fulfillment, deliveryAddress, tipCents, true);
    }

    /**
     * Read through a row mapper rather than {@code query(String.class).single()}: the whole
     * point of the pickup case is that the value is SQL NULL, and a null-valued single result
     * is exactly what that shortcut makes hard to tell apart from "no row at all".
     */
    private String storedDeliveryAddressEncrypted(String orderId) {
        List<String> rows = db.sql("SELECT \"deliveryAddressEncrypted\" FROM \"Order\" WHERE id = :id")
                .param("id", orderId)
                .query((rs, n) -> rs.getString("deliveryAddressEncrypted"))
                .list();
        assertThat(rows).hasSize(1);
        return rows.get(0);
    }

    private long orderCountFor(String buyerId) {
        return db.sql("SELECT COUNT(*) FROM \"Order\" WHERE \"buyerId\" = :buyerId")
                .param("buyerId", buyerId)
                .query(Long.class)
                .single();
    }

    @Test
    void confirmedDeliveryOrderStoresTheBuyerAddressEncryptedAndRecoverable() {
        Fixture f = seedKitchenWithOneDish(1200, 10);
        // Roughly half a mile north of the kitchen: inside the 10-mile radius, and US so the
        // country check passes too.
        when(geocoding.geocode(DELIVERY_ADDRESS))
                .thenReturn(new GeocodingService.Point(KITCHEN_LAT + 0.008, KITCHEN_LNG, "us"));

        Map<String, Object> result =
                ordersService.place(f.buyerId(), order(f, "delivery", DELIVERY_ADDRESS, 200));

        assertThat(result.get("confirmed")).isEqualTo(true);
        String orderId = ((OrderDetailResponse) result.get("order")).id();

        String stored = storedDeliveryAddressEncrypted(orderId);
        assertThat(stored).isNotNull();
        // At rest it must be ciphertext, not the address with extra steps.
        assertThat(stored).isNotEqualTo(DELIVERY_ADDRESS).doesNotContain("Grandview");
        assertThat(addressCrypto.decrypt(stored)).isEqualTo(DELIVERY_ADDRESS);
    }

    @Test
    void pickupOrderStoresNullRatherThanEncryptingAnEmptyAddress() {
        Fixture f = seedKitchenWithOneDish(1200, 10);

        Map<String, Object> result = ordersService.place(f.buyerId(), order(f, "pickup", null, 0));

        String orderId = ((OrderDetailResponse) result.get("order")).id();
        assertThat(storedDeliveryAddressEncrypted(orderId)).isNull();
        // A pickup order has no drop-off, so nothing should have been geocoded either.
        verifyNoInteractions(geocoding);
    }

    @Test
    void addressOutsideTheUnitedStatesIsRejectedAndNoOrderIsWritten() {
        Fixture f = seedKitchenWithOneDish(1200, 10);
        String address = "Ataturk Cd 5, Adana, Turkey";
        when(geocoding.geocode(address)).thenReturn(new GeocodingService.Point(37.0000, 35.3213, "tr"));

        assertThatThrownBy(() -> ordersService.place(f.buyerId(), order(f, "delivery", address, 0)))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("ADDRESS_OUTSIDE_US");

        assertThat(orderCountFor(f.buyerId())).isZero();
    }

    @Test
    void addressBeyondTheDeliveryRadiusIsRejectedAndNoOrderIsWritten() {
        Fixture f = seedKitchenWithOneDish(1200, 10);
        String address = "60 E Broad St, Columbus, OH 43215";
        // Downtown Columbus — US, so it clears the country check and fails on distance (~14 mi).
        when(geocoding.geocode(address)).thenReturn(new GeocodingService.Point(39.9612, -82.9988, "us"));

        assertThatThrownBy(() -> ordersService.place(f.buyerId(), order(f, "delivery", address, 0)))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("ADDRESS_OUT_OF_RANGE");

        assertThat(orderCountFor(f.buyerId())).isZero();
    }
}
