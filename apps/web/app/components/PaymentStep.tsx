"use client";

/** Story 3.4 — Stripe PaymentElement over the clientSecret POST /orders returned. The pending
 * order already holds the portions; paying settles it via the payment_intent.succeeded
 * webhook. NFR6: the card form is Stripe's — no PAN ever reaches our servers.
 *
 * Shared by checkout and chat: both can receive {requiresPayment: true} from the same
 * endpoint, so neither may treat a pending order as placed. */
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { money } from "../../lib/cart";

export const PAYMENT_TIMEOUT_MS = 45_000;

export interface PendingPayment {
  orderId: string;
  clientSecret: string;
  publishableKey: string;
}

export default function PaymentStep({
  payment,
  totalCents,
  onPaid,
}: {
  payment: PendingPayment;
  totalCents: number;
  /** Runs after Stripe settles, before the redirect to the order page. Checkout uses it to
   * empty the cart; the chat flow has no cart to clear and omits it. */
  onPaid?: () => void;
}) {
  const stripePromise = useMemo(() => loadStripe(payment.publishableKey), [payment.publishableKey]);
  if (!payment.clientSecret || !payment.publishableKey) {
    return (
      <div className="card" style={{ marginTop: 16, borderColor: "var(--brand-orange)" }}>
        <h2 style={{ fontSize: 17, color: "var(--brand-green)", marginTop: 0 }}>Payment</h2>
        <div className="form-error" role="alert">
          Payment could not be initialized. Please return to your order and try again.
        </div>
      </div>
    );
  }
  return (
    <div className="card" style={{ marginTop: 16, borderColor: "var(--brand-orange)" }}>
      <h2 style={{ fontSize: 17, color: "var(--brand-green)", marginTop: 0 }}>Payment</h2>
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret: payment.clientSecret,
          appearance: { variables: { colorPrimary: "#e8720c" } },
        }}
      >
        <PaymentForm orderId={payment.orderId} totalCents={totalCents} onPaid={onPaid} />
      </Elements>
    </div>
  );
}

function PaymentForm({
  orderId,
  totalCents,
  onPaid,
}: {
  orderId: string;
  totalCents: number;
  onPaid?: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [elementReady, setElementReady] = useState(false);

  async function pay() {
    if (!stripe || !elements || !elementReady || paying) return;
    setPaying(true);
    setPayError(null);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      // Cards settle inline; redirect-based methods return here via return_url. Either way
      // the order page shows "payment processing" until the webhook confirms it. The timeout
      // prevents a blocked Stripe iframe/network request from leaving the UI stuck forever.
      const result = await Promise.race([
        stripe.confirmPayment({
          elements,
          confirmParams: { return_url: `${window.location.origin}/orders/${orderId}` },
          redirect: "if_required",
        }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("PAYMENT_TIMEOUT")),
            PAYMENT_TIMEOUT_MS,
          );
        }),
      ]);
      if (result.error) {
        setPayError(result.error.message ?? "Payment failed — try another payment method.");
        return;
      }
      onPaid?.();
      router.push(`/orders/${orderId}`);
    } catch (error) {
      setPayError(
        error instanceof Error && error.message === "PAYMENT_TIMEOUT"
          ? "Payment confirmation timed out. Check your connection and try again."
          : "Payment could not be completed. Please try again.",
      );
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setPaying(false);
    }
  }

  return (
    <>
      {payError && (
        <div className="form-error" role="alert">
          {payError}
        </div>
      )}
      <PaymentElement
        onReady={() => setElementReady(true)}
        onLoadError={(event) => {
          setElementReady(false);
          setPayError(event.error.message ?? "The payment form could not load. Please try again.");
        }}
      />
      <button
        type="button"
        className="btn-primary"
        style={{ marginTop: 16 }}
        disabled={!stripe || !elements || !elementReady || paying}
        onClick={pay}
      >
        {paying ? "Paying…" : `Pay ${money(totalCents)}`}
      </button>
    </>
  );
}
