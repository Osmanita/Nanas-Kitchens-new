package com.nanaskitchens.api.delivery;

import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Sandbox stand-in used until DoorDash/Grubhub credentials are provisioned. Deterministic
 * fee, fake tracking URL; webhooks are simulated by calling POST /webhooks/delivery/mock
 * with the shared-secret HMAC signature.
 */
@Component
@ConditionalOnProperty(name = "app.delivery.provider", havingValue = "mock", matchIfMissing = true)
public class MockDeliveryProvider implements DeliveryProvider {

    private static final Logger log = LoggerFactory.getLogger(MockDeliveryProvider.class);

    private static final int BASE_FEE_CENTS = 399;

    private final Map<String, Integer> quotes = new ConcurrentHashMap<>();

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
        quotes.put(quoteId, feeCents);
        return new Quote(quoteId, feeCents);
    }

    @Override
    public CreatedDelivery create(String quoteId, String orderId, String pickupAddress, String dropoffAddress) {
        Integer feeCents = quotes.remove(quoteId);
        if (feeCents == null) {
            feeCents = BASE_FEE_CENTS;
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
