package com.nanaskitchens.api.delivery;

/**
 * Story 4.2/4.3 — delivery is abstracted behind this interface (architecture.md). DoorDash
 * Drive and Grubhub implementations plug in here; until partner credentials exist the mock
 * implementation ships behind the same interface (documented mitigation for partner-API
 * access delays).
 */
public interface DeliveryProvider {

    /** Prisma "DeliveryProvider" enum value: doordash | grubhub | mock. */
    String name();

    /**
     * dropoffAddress is the decrypted street address the courier delivers to. It used to be
     * missing from this interface entirely and DeliveryService passed null for the pickup
     * address as well, so a real partner adapter had nothing to dispatch against: the address
     * was written at checkout and read by nobody.
     */
    Quote quote(String pickupAddress, String dropoffAddress, String orderId);

    CreatedDelivery create(String quoteId, String orderId, String pickupAddress, String dropoffAddress);

    record Quote(String quoteId, int feeCents) {
    }

    record CreatedDelivery(String externalId, String trackingUrl, int feeCents) {
    }
}
