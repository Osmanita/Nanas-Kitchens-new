"use client";

import { useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { money } from "../../lib/cart";

export const PAYMENT_TIMEOUT_MS = 20_000;

export interface PendingPayment {
  orderId: string;
  // Older responses include these; hosted Checkout needs neither in the browser.
  clientSecret?: string;
  publishableKey?: string;
}

/** Top-level Stripe Checkout: Pay never depends on a third-party iframe.
 * The backend reuses the pending order; only the signed webhook confirms payment. */
export default function PaymentStep({ payment, totalCents }: {
  payment: PendingPayment;
  totalCents: number;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function pay() {
    if (inFlight.current) return;
    inFlight.current = true;
    setOpening(true);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PAYMENT_TIMEOUT_MS);
    try {
      const response = await apiFetch(`/orders/${encodeURIComponent(payment.orderId)}/checkout`, {
        method: "POST", signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(response.status === 409
          ? "This order is no longer awaiting payment. Check My orders for its status."
          : "Could not open secure checkout. Please try again.");
      }
      const url = new URL(body.url);
      if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com") {
        throw new Error("Could not open secure checkout. Please try again.");
      }
      sessionStorage.setItem("checkout_order", payment.orderId);
      window.location.assign(url.href);
    } catch (failure) {
      setError(controller.signal.aborted
        ? "Checkout took too long to respond. Please try again — your order will not be duplicated."
        : failure instanceof Error ? failure.message : "Could not open secure checkout. Please try again.");
    } finally {
      clearTimeout(timeout);
      inFlight.current = false;
      setOpening(false);
    }
  }

  return (
    <section className="card" aria-label="Payment" style={{ marginTop: 16, borderColor: "var(--brand-green)" }}>
      <h2 style={{ fontSize: 17, color: "var(--brand-green)", marginTop: 0 }}>Payment</h2>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--brand-muted)" }}>
        Continue to Stripe’s secure payment page to enter your card details.
        You’ll return here after payment.
      </p>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button type="button" className="btn-primary" disabled={opening} onClick={pay}>
        {opening ? "Opening secure checkout…" : `Pay ${money(totalCents)}`}
      </button>
      <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--brand-muted)" }}>
        Nothing is charged until you complete payment on Stripe.
      </p>
    </section>
  );
}
