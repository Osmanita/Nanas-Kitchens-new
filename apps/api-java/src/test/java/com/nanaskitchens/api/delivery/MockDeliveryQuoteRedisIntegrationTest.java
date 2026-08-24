package com.nanaskitchens.api.delivery;

import static org.assertj.core.api.Assertions.assertThat;

import com.nanaskitchens.api.support.IntegrationTest;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;

/**
 * A courier quote is issued on one request and redeemed on a later one, so with the quote map
 * held in a field the two could land on different tasks and the redemption would find nothing.
 * The mock then quietly fell back to its base fee — which happens to equal what it quoted, so
 * the bug was invisible here and would only surface against a provider that prices by distance.
 *
 * <p>Asserting on the returned fee therefore proves nothing. These tests assert on the Redis
 * key instead: that issuing writes it, that a DIFFERENT provider instance can redeem it, and
 * that redeeming consumes it.
 */
class MockDeliveryQuoteRedisIntegrationTest extends IntegrationTest {

    private static final String PICKUP = "10 Kitchen Ln, Powell, OH";
    private static final String DROPOFF = "123 Grandview Ave, Powell, OH";

    @Autowired
    private DeliveryProvider provider;

    @Autowired
    private ReactiveStringRedisTemplate redis;

    private String storedQuote(String quoteId) {
        return redis.opsForValue().get("delivery:quote:" + quoteId).block(Duration.ofSeconds(5));
    }

    @Test
    void aQuoteIssuedOnOneInstanceIsRedeemableOnAnother() {
        DeliveryProvider.Quote quote = provider.quote(PICKUP, DROPOFF, "order-1");

        // In shared storage, not in the issuing instance's heap.
        assertThat(storedQuote(quote.quoteId())).isEqualTo(Integer.toString(quote.feeCents()));

        // A second task, with an empty heap of its own, redeems it.
        MockDeliveryProvider otherTask = new MockDeliveryProvider(redis);
        DeliveryProvider.CreatedDelivery created =
                otherTask.create(quote.quoteId(), "order-1", PICKUP, DROPOFF);

        assertThat(created.feeCents()).isEqualTo(quote.feeCents());
        assertThat(created.externalId()).startsWith("mockd_");
        assertThat(created.trackingUrl()).contains(created.externalId());
    }

    @Test
    void redeemingAQuoteConsumesIt() {
        DeliveryProvider.Quote quote = provider.quote(PICKUP, DROPOFF, "order-2");

        provider.create(quote.quoteId(), "order-2", PICKUP, DROPOFF);

        // Single use: a replay must not find a live quote sitting there indefinitely.
        assertThat(storedQuote(quote.quoteId())).isNull();
    }

    @Test
    void twoQuotesDoNotShareAKey() {
        DeliveryProvider.Quote first = provider.quote(PICKUP, DROPOFF, "order-3");
        DeliveryProvider.Quote second = provider.quote(PICKUP, DROPOFF, "order-4");

        assertThat(first.quoteId()).isNotEqualTo(second.quoteId());

        provider.create(first.quoteId(), "order-3", PICKUP, DROPOFF);

        // Consuming one must leave the other alone.
        assertThat(storedQuote(second.quoteId())).isNotNull();
    }
}
