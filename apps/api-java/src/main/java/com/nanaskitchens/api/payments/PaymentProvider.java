package com.nanaskitchens.api.payments;

/**
 * Story 3.4 — payments behind an interface, mirroring DeliveryProvider: the mock ships as
 * default so the demo works without Stripe keys; the real Stripe implementation activates
 * via app.payments.provider=stripe.
 */
public interface PaymentProvider {

    /** mock | stripe */
    String name();

    /**
     * Creates (or idempotently retrieves) the PaymentIntent for an order. A "succeeded"
     * status means no client-side payment step is needed (mock); anything else leaves the
     * order pending until the provider's webhook settles it.
     */
    Intent createIntent(String orderId, int amountCents, String idempotencyKey);

    /**
     * Attempts to cancel an intent (used before expiring an abandoned pending order so a
     * late payment can't be captured for an order we're about to release). Returns false
     * when the intent is already in a terminal state — the caller must then leave the
     * order alone and let the webhook settle it.
     */
    boolean tryCancelIntent(String paymentIntentId);

    /**
     * FR21 — refunds a captured payment when its order is declined or cancelled. Returns
     * the provider refund id, or null when the refund could not be issued; the caller
     * records the failure for manual follow-up instead of blocking the order transition.
     */
    String refund(String paymentIntentId, int amountCents);

    /** Client-side key for the payment sheet; null when the provider needs no client step. */
    String publishableKey();

    /** Hosted checkout for browsers that cannot load embedded payment frames. */
    default Checkout createCheckout(String orderId, int amountCents) {
        throw new UnsupportedOperationException("Hosted checkout is not available");
    }

    default Checkout retrieveCheckout(String sessionId) {
        throw new UnsupportedOperationException("Hosted checkout is not available");
    }

    record Checkout(String id, String url) {
    }

    record Intent(String id, String clientSecret, String status) {
    }
}
