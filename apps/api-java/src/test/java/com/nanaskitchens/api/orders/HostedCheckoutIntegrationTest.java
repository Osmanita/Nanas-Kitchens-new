package com.nanaskitchens.api.orders;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.nanaskitchens.api.orders.dto.CreateOrderRequest;
import com.nanaskitchens.api.payments.PaymentProvider;
import com.nanaskitchens.api.payments.PaymentsService;
import com.nanaskitchens.api.support.IntegrationTest;
import com.nanaskitchens.api.support.TestData;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.server.ResponseStatusException;

class HostedCheckoutIntegrationTest extends IntegrationTest {
    @Autowired OrdersService orders;
    @Autowired PaymentsService payments;
    @Autowired JdbcClient db;
    @MockitoBean PaymentProvider provider;

    @BeforeEach void mockStripe() {
        when(provider.name()).thenReturn("stripe");
        when(provider.publishableKey()).thenReturn("pk_test_example");
        when(provider.createIntent(anyString(), anyInt(), anyString())).thenAnswer(call ->
                new PaymentProvider.Intent("pi_" + UUID.randomUUID(), "secret", "requires_payment_method"));
        when(provider.tryCancelIntent(anyString())).thenReturn(true);
        when(provider.createCheckout(anyString(), anyInt())).thenAnswer(call ->
                new PaymentProvider.Checkout("cs_" + call.getArgument(0), "https://checkout.stripe.com/test"));
        when(provider.retrieveCheckout(anyString())).thenAnswer(call ->
                new PaymentProvider.Checkout(call.getArgument(0), "https://checkout.stripe.com/test"));
    }

    record Fixture(String buyer, String order, String item, String intent) {}
    Fixture pendingOrder() {
        String seller = TestData.insertUser(db, "seller", UUID.randomUUID() + "@test.dev");
        String buyer = TestData.insertUser(db, "buyer", UUID.randomUUID() + "@test.dev");
        String kitchen = TestData.insertKitchen(db, seller, 40.1578, -83.0752);
        String dish = TestData.insertDish(db, kitchen, "Manti", 1200);
        String day = TestData.insertMenuDayToday(db, kitchen);
        String item = TestData.insertMenuItem(db, day, dish, 10);
        var result = orders.place(buyer, new CreateOrderRequest(kitchen, day,
                List.of(new CreateOrderRequest.Item(item, 2)), "17:00", "pickup", null, 0, true));
        String order = (String) result.get("orderId");
        return new Fixture(buyer, order, item, reference(order));
    }
    String reference(String order) {
        return db.sql("SELECT \"paymentIntentId\" FROM \"Order\" WHERE id = :id")
                .param("id", order).query(String.class).single();
    }

    @Test void retriesReuseTheSessionAndDoNotReserveOrChargeTwice() {
        var f = pendingOrder();
        assertThat(orders.checkout(f.buyer(), f.order())).containsKey("url");
        orders.checkout(f.buyer(), f.order());
        verify(provider, times(1)).tryCancelIntent(f.intent());
        verify(provider, times(1)).createCheckout(f.order(), 2400);
        assertThat(db.sql("SELECT \"portionsRemaining\" FROM \"MenuItem\" WHERE id = :id")
                .param("id", f.item()).query(Integer.class).single()).isEqualTo(8);
    }

    @Test void anotherBuyerCannotOpenCheckout() {
        var f = pendingOrder();
        assertThatThrownBy(() -> orders.checkout(UUID.randomUUID().toString(), f.order()))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("404");
        verify(provider, never()).tryCancelIntent(anyString());
        verify(provider, never()).createCheckout(anyString(), anyInt());
    }

    @Test void anInFlightPaymentCannotBeReplacedByAnotherCharge() {
        var f = pendingOrder();
        when(provider.tryCancelIntent(f.intent())).thenReturn(false);
        assertThatThrownBy(() -> orders.checkout(f.buyer(), f.order())).hasMessageContaining("PAYMENT_IN_PROGRESS");
        assertThat(reference(f.order())).isEqualTo(f.intent());
        verify(provider, never()).createCheckout(anyString(), anyInt());
    }

    @Test void signedCheckoutSettlementHandlesOldCancellationAndEventReordering() {
        var f = pendingOrder();
        orders.checkout(f.buyer(), f.order());
        String session = reference(f.order());
        assertThat(payments.releaseFailedPayment(f.intent(), "canceled")).containsEntry("applied", false);
        String paidIntent = "pi_paid_" + UUID.randomUUID();
        assertThat(payments.markPaid(paidIntent)).containsEntry("applied", false);
        assertThat(payments.markCheckoutPaid(session, paidIntent, 2400L, "usd")).containsEntry("status", "confirmed");
        assertThat(reference(f.order())).isEqualTo(paidIntent);
        assertThat(payments.markCheckoutPaid(session, paidIntent, 2400L, "usd")).containsEntry("applied", false);
        assertThat(orders.detail(f.buyer(), f.order()).status()).isEqualTo("confirmed");
    }

    @Test void wrongAmountDoesNotConfirmAndExpiredCheckoutReleasesOnce() {
        var f = pendingOrder();
        orders.checkout(f.buyer(), f.order());
        String session = reference(f.order());
        assertThatThrownBy(() -> payments.markCheckoutPaid(session, "pi_wrong", 1L, "usd"))
                .hasMessageContaining("PAYMENT_AMOUNT_MISMATCH");
        assertThat(reference(f.order())).isEqualTo(session);
        payments.releaseFailedPayment(session, "checkout.session.expired");
        payments.releaseFailedPayment(session, "checkout.session.expired");
        assertThat(orders.detail(f.buyer(), f.order()).status()).isEqualTo("cancelled");
        assertThat(db.sql("SELECT \"portionsRemaining\" FROM \"MenuItem\" WHERE id = :id")
                .param("id", f.item()).query(Integer.class).single()).isEqualTo(10);
    }
}
