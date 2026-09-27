package com.nanaskitchens.api.polls;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.nanaskitchens.api.menus.MenusService;
import com.nanaskitchens.api.inventory.InventoryService;
import com.nanaskitchens.api.orders.OrdersService;
import com.nanaskitchens.api.payments.PaymentProvider;
import com.nanaskitchens.api.payments.PaymentsService;
import com.nanaskitchens.api.support.IntegrationTest;
import com.nanaskitchens.api.support.TestData;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

class PollPreorderIntegrationTest extends IntegrationTest {
    @Autowired PollsService polls;
    @Autowired MenusService menus;
    @Autowired InventoryService inventory;
    @Autowired OrdersService orders;
    @Autowired PaymentsService payments;
    @Autowired JdbcClient db;
    @MockitoBean PaymentProvider provider;
    private static final ZoneId ZONE = ZoneId.of("America/New_York");
    record Fixture(String seller, String kitchen, List<String> dishes, String poll) {}

    @BeforeEach void mockPayments() {
        when(provider.name()).thenReturn("stripe");
        when(provider.publishableKey()).thenReturn("pk_test_fixture");
        when(provider.createIntent(anyString(), anyInt(), anyString())).thenAnswer(call ->
                new PaymentProvider.Intent("pi_" + UUID.randomUUID(), "test_secret", "requires_payment_method"));
    }

    String buyer() { return TestData.insertUser(db, "buyer", UUID.randomUUID() + "@test.dev"); }
    Fixture fixture(int minimum, int capacity) {
        String seller = TestData.insertUser(db, "seller", UUID.randomUUID() + "@test.dev");
        String kitchen = TestData.insertKitchen(db, seller, 40.1578, -83.0752);
        var dishes = List.of(TestData.insertDish(db, kitchen, "Manti", 1200),
                TestData.insertDish(db, kitchen, "Soup", 600), TestData.insertDish(db, kitchen, "Sarma", 1000));
        var day = LocalDate.now(ZONE).plusDays(1);
        var result = polls.create(seller, kitchen, new PollsController.CreatePollRequest("What shall I cook tomorrow?",
                dishes, day.toString(), ZONE.getId(), day.atTime(10, 0).toString(), List.of("17:00", "18:00"), minimum, capacity));
        return new Fixture(seller, kitchen, dishes, (String) result.get("id"));
    }
    Map<String, Object> vote(Fixture f, String buyer, int option, int qty) {
        return polls.vote(buyer, f.poll(), new PollsController.VoteRequest(option, qty, "17:00", 40.1578, -83.0752));
    }
    Map<?, ?> reservation(Fixture f, String buyer) {
        return (Map<?, ?>) polls.preorders(buyer).stream().filter(p -> f.poll().equals(p.get("id"))).findFirst().orElseThrow().get("preorder");
    }
    int remaining(Fixture f, int option) {
        return db.sql("SELECT mi.\"portionsRemaining\" FROM \"MenuItem\" mi JOIN \"Poll\" p ON p.\"menuDayId\" = mi.\"menuDayId\" WHERE p.id = :id AND mi.\"dishId\" = :dish")
                .param("id", f.poll()).param("dish", f.dishes().get(option)).query(Integer.class).single();
    }

    @Test void onlyNeighborsCanSeeAndVoteAndNoMoneyMovesDuringVoting() {
        var f = fixture(3, 10); var b = buyer();
        assertThat(polls.nearby(b, 40.1578, -83.0752)).anyMatch(p -> f.poll().equals(p.get("id")));
        assertThat(polls.nearby(b, 41.0, -84.0)).noneMatch(p -> f.poll().equals(p.get("id")));
        assertThatThrownBy(() -> polls.vote(b, f.poll(), new PollsController.VoteRequest(0, 2, "17:00", 41.0, -84.0)))
                .hasMessageContaining("OUTSIDE_POLL_AREA");
        vote(f, b, 0, 2); vote(f, b, 0, 2);
        assertThat(reservation(f, b).get("status")).isEqualTo("awaiting_result");
        assertThatThrownBy(() -> vote(f, b, 1, 2)).hasMessageContaining("ALREADY_VOTED");
        assertThatThrownBy(() -> polls.checkout(b, f.poll())).hasMessageContaining("PREORDER_NOT_READY");
        verify(provider, never()).createIntent(anyString(), anyInt(), anyString());
    }

    @Test void winnerAndSufficientDemandCookButOtherRequestsCloseWithoutCharge() {
        var f = fixture(3, 10); var soup = buyer(); var sarma = buyer();
        vote(f, buyer(), 0, 1); vote(f, buyer(), 0, 1); vote(f, buyer(), 0, 1);
        vote(f, soup, 1, 3); vote(f, sarma, 2, 1);
        var result = polls.finalizeMenu(f.seller(), f.poll());
        assertThat((Integer[]) result.get("cookingOptions")).containsExactly(0, 1);
        assertThat(remaining(f, 0)).isEqualTo(7);
        assertThat(remaining(f, 1)).isEqualTo(7);
        assertThat(reservation(f, soup).get("status")).isEqualTo("ready_for_payment");
        assertThat(reservation(f, sarma).get("status")).isEqualTo("not_cooking");
        polls.finalizeMenu(f.seller(), f.poll());
        assertThat(remaining(f, 0)).isEqualTo(7);
        assertThat(db.sql("SELECT count(*) FROM \"Notification\" WHERE \"userId\" = :buyer AND type = 'poll_result'")
                .param("buyer", soup).query(Integer.class).single()).isEqualTo(1);
        verify(provider, never()).createIntent(anyString(), anyInt(), anyString());
    }

    @Test void checkoutPreservesPriceAndStockAndOnlyRevealsAddressAfterSettlement() {
        var f = fixture(3, 10); var b = buyer();
        vote(f, b, 0, 2); polls.finalizeMenu(f.seller(), f.poll());
        db.sql("UPDATE \"Dish\" SET \"priceCents\" = 9900 WHERE id = :id").param("id", f.dishes().getFirst()).update();
        String order = (String) polls.checkout(b, f.poll()).get("orderId");
        assertThat(polls.checkout(b, f.poll()).get("orderId")).isEqualTo(order);
        assertThat(orders.detail(b, order).totalCents()).isEqualTo(2400);
        assertThat(orders.detail(b, order).readySlot().toLocalDate()).isEqualTo(LocalDate.now(ZONE).plusDays(1));
        assertThat(orders.detail(b, order).pickupAddress()).isNull();
        assertThat(remaining(f, 0)).isEqualTo(8);
        verify(provider, times(1)).createIntent(anyString(), eq(2400), anyString());
        payments.markPaid(orders.detail(b, order).paymentIntentId());
        assertThat(orders.detail(b, order).pickupAddress()).isEqualTo(TestData.KITCHEN_ADDRESS);
    }

    @Test void failedPaymentSetupRollsBackAndReservationCanBeRetried() {
        var f = fixture(3, 10); var b = buyer();
        vote(f, b, 0, 2); polls.finalizeMenu(f.seller(), f.poll());
        when(provider.createIntent(anyString(), anyInt(), anyString())).thenThrow(new IllegalStateException("provider unavailable"));
        assertThatThrownBy(() -> polls.checkout(b, f.poll())).hasMessageContaining("provider unavailable");
        assertThat(remaining(f, 0)).isEqualTo(8);
        assertThat(reservation(f, b).get("status")).isEqualTo("ready_for_payment");
        assertThat(reservation(f, b).get("orderId")).isNull();
        reset(provider);
        mockPayments();
        assertThat(polls.checkout(b, f.poll())).containsKey("orderId");
    }

    @Test void tiedWinnersCookAndCancellationReleasesPortionsExactlyOnce() {
        var f = fixture(4, 10); var b = buyer();
        vote(f, b, 0, 2); vote(f, buyer(), 1, 1);
        assertThat((Integer[]) polls.finalizeMenu(f.seller(), f.poll()).get("cookingOptions")).containsExactly(0, 1);
        polls.cancel(b, f.poll()); polls.cancel(b, f.poll());
        assertThat(remaining(f, 0)).isEqualTo(10);
    }

    @Test void expiredUnpaidReservationReleasesInventoryExactlyOnce() {
        var f = fixture(3, 10); var b = buyer();
        vote(f, b, 0, 2); polls.finalizeMenu(f.seller(), f.poll());
        db.sql("UPDATE \"Poll\" SET \"serviceDate\" = :day WHERE id = :id")
                .param("day", LocalDate.now(ZONE).minusDays(1)).param("id", f.poll()).update();
        assertThatThrownBy(() -> polls.checkout(b, f.poll())).hasMessageContaining("PREORDER_EXPIRED");
        polls.expire(f.poll()); polls.expire(f.poll());
        assertThat(remaining(f, 0)).isEqualTo(10);
        assertThat(reservation(f, b).get("status")).isEqualTo("expired");
    }

    @Test void normalMenuEditorCannotBypassPollAndOtherUsersCannotManageReservations() {
        var f = fixture(3, 10); var b = buyer(); vote(f, b, 0, 1);
        String menu = db.sql("SELECT \"menuDayId\" FROM \"Poll\" WHERE id = :id").param("id", f.poll()).query(String.class).single();
        assertThatThrownBy(() -> menus.publish(f.seller(), f.kitchen(), menu)).hasMessageContaining("POLL_MENU_MANAGED");
        assertThatThrownBy(() -> polls.finalizeMenu(b, f.poll())).hasMessageContaining("403");
        assertThatThrownBy(() -> polls.checkout(buyer(), f.poll())).hasMessageContaining("PREORDER_NOT_FOUND");
        assertThatThrownBy(() -> polls.cancel(buyer(), f.poll())).hasMessageContaining("PREORDER_NOT_FOUND");
        db.sql("UPDATE \"Poll\" SET \"closesAt\" = now() - interval '1 minute' WHERE id = :id").param("id", f.poll()).update();
        assertThatThrownBy(() -> vote(f, buyer(), 0, 1)).hasMessageContaining("POLL_CLOSED");
    }

    @Test void simultaneousVotesCannotOverbookLastPortions() throws Exception {
        var f = fixture(2, 2); var a = buyer(); var b = buyer(); var start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            List<Future<Boolean>> attempts = new ArrayList<>();
            for (String user : List.of(a, b)) attempts.add(executor.submit(() -> {
                start.await();
                try { vote(f, user, 0, 2); return true; }
                catch (org.springframework.web.server.ResponseStatusException e) {
                    assertThat(e.getReason()).isEqualTo("POLL_PORTIONS_FULL"); return false;
                }
            }));
            start.countDown(); int succeeded = 0;
            for (var attempt : attempts) if (attempt.get(10, TimeUnit.SECONDS)) succeeded++;
            assertThat(succeeded).isEqualTo(1);
        }
    }

    @Test void sellerStockCorrectionsContinueToHonorUnpaidReservations() {
        var f = fixture(3, 10); var b = buyer(); vote(f, b, 0, 2);
        String item = db.sql("SELECT mi.id FROM \"MenuItem\" mi JOIN \"Poll\" p ON p.\"menuDayId\" = mi.\"menuDayId\" WHERE p.id = :id AND mi.\"dishId\" = :dish")
                .param("id", f.poll()).param("dish", f.dishes().getFirst()).query(String.class).single();
        assertThatThrownBy(() -> inventory.adjust(f.seller(), item, 1)).hasMessageContaining("POLL_MENU_MANAGED");
        polls.finalizeMenu(f.seller(), f.poll());
        inventory.adjust(f.seller(), item, 0);
        assertThat(remaining(f, 0)).isEqualTo(8);
        assertThatThrownBy(() -> inventory.adjust(f.seller(), item, -9)).hasMessageContaining("ADJUST_BELOW_COMMITTED");
        inventory.adjust(f.seller(), item, 2);
        assertThat(remaining(f, 0)).isEqualTo(10);
        polls.checkout(b, f.poll());
        inventory.adjust(f.seller(), item, 0);
        assertThat(remaining(f, 0)).isEqualTo(10);
    }
}
