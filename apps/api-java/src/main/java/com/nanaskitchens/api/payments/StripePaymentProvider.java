package com.nanaskitchens.api.payments;

import com.stripe.StripeClient;
import com.stripe.exception.StripeException;
import com.stripe.model.PaymentIntent;
import com.stripe.net.RequestOptions;
import com.stripe.param.PaymentIntentCreateParams;
import com.stripe.param.checkout.SessionCreateParams;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Story 3.4 — real PaymentIntents (NFR6: card data never touches our servers; the client
 * confirms with Stripe Elements/PaymentSheet against the clientSecret). The architecture's
 * Connect transfer_data/application_fee is deferred: sellers have no Connect onboarding
 * story yet, so charges land on the platform account and payout math uses the
 * commissionCents already recorded on each Order (FR21).
 */
@Component
@ConditionalOnProperty(name = "app.payments.provider", havingValue = "stripe")
public class StripePaymentProvider implements PaymentProvider {

    private final StripeClient client;
    private final String publishableKey;
    private final String webBaseUrl;

    public StripePaymentProvider(
            @Value("${app.payments.stripe.secret-key}") String secretKey,
            @Value("${app.payments.stripe.publishable-key}") String publishableKey,
            @Value("${app.payments.web-base-url:http://localhost:3000}") String webBaseUrl) {
        if (secretKey == null || secretKey.isBlank()) {
            throw new IllegalStateException("app.payments.provider=stripe requires STRIPE_SECRET_KEY");
        }
        this.client = new StripeClient(secretKey);
        this.publishableKey = publishableKey;
        this.webBaseUrl = webBaseUrl.replaceAll("/+$", "");
    }

    @Override
    public String name() {
        return "stripe";
    }

    @Override
    public Intent createIntent(String orderId, int amountCents, String idempotencyKey) {
        PaymentIntentCreateParams params = PaymentIntentCreateParams.builder()
                .setAmount((long) amountCents)
                .setCurrency("usd")
                .putMetadata("orderId", orderId)
                .setAutomaticPaymentMethods(
                        PaymentIntentCreateParams.AutomaticPaymentMethods.builder().setEnabled(true).build())
                .build();
        RequestOptions options = RequestOptions.builder().setIdempotencyKey(idempotencyKey).build();
        try {
            PaymentIntent intent = client.paymentIntents().create(params, options);
            return new Intent(intent.getId(), intent.getClientSecret(), intent.getStatus());
        } catch (StripeException e) {
            // Thrown inside the order transaction → rollback restores the decremented portions.
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_ERROR");
        }
    }

    @Override
    public boolean tryCancelIntent(String paymentIntentId) {
        try {
            // While hosted Checkout is open the order holds its session id. The signed
            // success webhook replaces it with the actual PaymentIntent id for refunds.
            if (paymentIntentId.startsWith("cs_")) {
                var session = client.checkout().sessions().retrieve(paymentIntentId);
                if ("expired".equals(session.getStatus())) return true;
                if (!"open".equals(session.getStatus())) return false;
                client.checkout().sessions().expire(paymentIntentId);
                return true;
            }
            if ("canceled".equals(client.paymentIntents().retrieve(paymentIntentId).getStatus())) return true;
            client.paymentIntents().cancel(paymentIntentId);
            return true;
        } catch (StripeException e) {
            return false; // terminal state (e.g. already succeeded) — let the webhook settle it
        }
    }

    @Override
    public String refund(String paymentIntentId, int amountCents) {
        try {
            com.stripe.model.Refund refund = client.refunds().create(
                    com.stripe.param.RefundCreateParams.builder()
                            .setPaymentIntent(paymentIntentId)
                            .setAmount((long) amountCents)
                            .build());
            return refund.getId();
        } catch (StripeException e) {
            // Never blocks the decline/cancel — the caller audits it for manual follow-up.
            return null;
        }
    }

    @Override
    public String publishableKey() {
        return publishableKey;
    }

    @Override
    public Checkout createCheckout(String orderId, int amountCents) {
        var params = SessionCreateParams.builder()
                .setMode(SessionCreateParams.Mode.PAYMENT)
                // Keep the charged currency and amount identical to the USD order review.
                .setAdaptivePricing(SessionCreateParams.AdaptivePricing.builder().setEnabled(false).build())
                .setClientReferenceId(orderId)
                .setSuccessUrl(webBaseUrl + "/orders/" + orderId)
                .setCancelUrl(webBaseUrl + "/orders/" + orderId + "?checkout=cancelled")
                .setPaymentIntentData(SessionCreateParams.PaymentIntentData.builder()
                        .putMetadata("orderId", orderId).build())
                .addLineItem(SessionCreateParams.LineItem.builder().setQuantity(1L)
                        .setPriceData(SessionCreateParams.LineItem.PriceData.builder()
                                .setCurrency("usd").setUnitAmount((long) amountCents)
                                .setProductData(SessionCreateParams.LineItem.PriceData.ProductData.builder()
                                        .setName("Nanas' Kitchens order")
                                        .setDescription("Food and any delivery fee or tip included in your order total")
                                        .build()).build()).build())
                .build();
        try {
            var session = client.checkout().sessions().create(params,
                    RequestOptions.builder().setIdempotencyKey("hosted-checkout:" + orderId).build());
            return new Checkout(session.getId(), session.getUrl());
        } catch (StripeException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_ERROR");
        }
    }

    @Override
    public Checkout retrieveCheckout(String sessionId) {
        try {
            var session = client.checkout().sessions().retrieve(sessionId);
            if (!"open".equals(session.getStatus()) || session.getUrl() == null) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "CHECKOUT_NOT_OPEN");
            }
            return new Checkout(session.getId(), session.getUrl());
        } catch (StripeException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_ERROR");
        }
    }
}
