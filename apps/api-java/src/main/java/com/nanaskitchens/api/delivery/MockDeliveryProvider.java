package com.nanaskitchens.api.delivery;

import java.time.Duration;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * Sandbox stand-in used until DoorDash/Grubhub credentials are provisioned. Deterministic
 * fee, fake tracking URL; webhooks are simulated by calling POST /webhooks/delivery/mock
 * with the shared-secret HMAC signature.
 *
 * <p>Quotes live in Redis, not in a field. They used to sit in a per-process map, so a quote
 * issued by one task and redeemed by another came back empty — the fee then silently fell back
 * to the base rate, which happens to match today and would not the moment a real provider
 * quotes by distance. Same reason as the portions channel: nothing may depend on the two calls
 * landing on the same instance.
 */
@Component
@ConditionalOnProperty(name = "app.delivery.provider", havingValue = "mock", matchIfMissing = true)
public class MockDeliveryProvider implements DeliveryProvider {

    private static final Logger log = LoggerFactory.getLogger(MockDeliveryProvider.class);

    private static final int BASE_FEE_CENTS = 399;

    /** Long enough for a seller to accept and cook, short enough not to accumulate forever. */
    private static final Duration QUOTE_TTL = Duration.ofHours(6);
    private static final String QUOTE_KEY_PREFIX = "delivery:quote:";
    private static final Duration REDIS_TIMEOUT = Duration.ofSeconds(2);

    private final ReactiveStringRedisTemplate redis;

    public MockDeliveryProvider(ReactiveStringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public String name() {
        return "mock";
    }

    @Override
    public Quote quote(String pickupAddress, String dropoffAddress, String orderId) {
        // Matches the fee shown at checkout; a real DoorDash/Grubhub adapter replaces this quote,
        // and would price the pickup -> dropoff leg from exactly these two addresses.
        int feeCents = BASE_FEE_CENTS;
        String quoteId = "mockq_" + UUID.randomUUID();
        redis.opsForValue()
                .set(QUOTE_KEY_PREFIX + quoteId, Integer.toString(feeCents), QUOTE_TTL)
                .block(REDIS_TIMEOUT);
        return new Quote(quoteId, feeCents);
    }

    @Override
    public CreatedDelivery create(String quoteId, String orderId, String pickupAddress, String dropoffAddress) {
        String stored = redis.opsForValue().getAndDelete(QUOTE_KEY_PREFIX + quoteId).block(REDIS_TIMEOUT);
        int feeCents = stored == null ? BASE_FEE_CENTS : Integer.parseInt(stored);
        if (stored == null) {
            // Expired or already redeemed. Worth a line: with the quote in Redis this should be
            // rare, and if it stops being rare the TTL or the redemption path is wrong.
            log.warn("Delivery quote {} not found for order {}; falling back to the base fee", quoteId, orderId);
        }
        // Logged, not stored: this stands in for handing the leg to a courier. Street addresses
        // are personal data, so only the town-level tail goes to the log.
        log.info("Mock delivery for order {}: {} -> {}", orderId,
                coarse(pickupAddress), coarse(dropoffAddress));
        String externalId = "mockd_" + UUID.randomUUID();
        return new CreatedDelivery(externalId, "https://track.example.com/mock/" + externalId, feeCents);
    }

    /** Drops everything before the last two comma-separated parts (house number, street). */
    private static String coarse(String address) {
        if (address == null || address.isBlank()) {
            return "(none)";
        }
        String[] parts = address.split(",");
        return parts.length <= 2 ? "(set)" : String.join(",", parts[parts.length - 2], parts[parts.length - 1]).trim();
    }
}
