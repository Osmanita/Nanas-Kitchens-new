package com.nanaskitchens.api.payments;

import com.stripe.exception.SignatureVerificationException;
import com.stripe.model.Event;
import com.stripe.model.PaymentIntent;
import com.stripe.model.StripeObject;
import com.stripe.net.Webhook;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Story 3.4 — Stripe events settle pending orders (architecture.md: webhook signature
 * verification). Registered even in mock mode but rejects everything until
 * STRIPE_WEBHOOK_SECRET is configured.
 */
@RestController
public class StripeWebhookController {

    private final PaymentsService payments;
    private final String webhookSecret;

    public StripeWebhookController(
            PaymentsService payments,
            @Value("${app.payments.stripe.webhook-secret:}") String webhookSecret) {
        this.payments = payments;
        this.webhookSecret = webhookSecret;
    }

    @PostMapping("/webhooks/stripe")
    public Map<String, Object> handle(
            @RequestBody byte[] body,
            @RequestHeader(value = "Stripe-Signature", required = false) String signature) {
        if (webhookSecret == null || webhookSecret.isBlank()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "PAYMENTS_WEBHOOK_DISABLED");
        }
        if (signature == null || signature.isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "SIGNATURE_MISSING");
        }
        Event event;
        try {
            event = Webhook.constructEvent(new String(body, StandardCharsets.UTF_8), signature, webhookSecret);
        } catch (SignatureVerificationException e) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "SIGNATURE_INVALID");
        }
        return switch (event.getType()) {
            case "payment_intent.succeeded" -> payments.markPaid(intentId(event));
            case "payment_intent.payment_failed" ->
                    payments.releaseFailedPayment(intentId(event), "payment_failed");
            case "payment_intent.canceled" -> payments.releaseFailedPayment(intentId(event), "canceled");
            case "checkout.session.completed", "checkout.session.async_payment_succeeded" -> {
                var session = checkoutSession(event);
                yield "paid".equals(session.getPaymentStatus())
                        ? payments.markCheckoutPaid(session.getId(), session.getPaymentIntent(),
                                session.getAmountTotal(), session.getCurrency())
                        : Map.of("applied", false);
            }
            case "checkout.session.expired", "checkout.session.async_payment_failed" ->
                    payments.releaseFailedPayment(checkoutSession(event).getId(), event.getType());
            default -> Map.of("ignored", true, "type", event.getType());
        };
    }

    private static String intentId(Event event) {
        StripeObject object = eventObject(event);
        if (object instanceof PaymentIntent intent) return intent.getId();
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "UNEXPECTED_EVENT_OBJECT");
    }

    private static com.stripe.model.checkout.Session checkoutSession(Event event) {
        if (eventObject(event) instanceof com.stripe.model.checkout.Session session) return session;
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "UNEXPECTED_EVENT_OBJECT");
    }

    private static StripeObject eventObject(Event event) {
        return event.getDataObjectDeserializer().getObject().orElseGet(() -> {
            try {
                // API-version drift between Stripe and the SDK — force-deserialize; the id
                // field is stable across versions, which is all we read.
                return event.getDataObjectDeserializer().deserializeUnsafe();
            } catch (com.stripe.exception.EventDataObjectDeserializationException e) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "EVENT_UNPARSEABLE");
            }
        });
    }
}
