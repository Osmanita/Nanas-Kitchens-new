"use client";

/** Order confirmation & tracking (front-end-spec.md Order Tracking, FR10). The pickup street
 * address is only present here once the order is placed — the server withholds it otherwise. */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { clearCart, money } from "../../../lib/cart";
import { pickupDay } from "../../../lib/polls";
import PaymentStep from "../../components/PaymentStep";
import {
  isWithinReviewWindow,
  REVIEW_WINDOW_MONTHS,
} from "../../../lib/reviewWindow";

import { PageIntro, OrderStatus } from "../../components/PageKit";
import styles from "../../marketplace.module.css";

interface OrderItem {
  id: string;
  qty: number;
  unitPriceCents: number;
  menuItem: { dish: { name: string; photo: string | null } };
}

interface DeliveryJob {
  provider: string;
  status: string;
  trackingUrl: string | null;
  feeCents: number;
}

interface OrderDetail {
  id: string;
  status: string;
  readySlot: string;
  fulfillment: string;
  totalCents: number;
  refundedAt: string | null;
  createdAt: string;
  items: OrderItem[];
  kitchenId: string;
  kitchenName: string;
  pickupAddress: string | null;
  pickupTimeZone?: string;
  deliveryJob: DeliveryJob | null;
}

interface Review {
  rating: number;
  comment: string | null;
}

// Mirrors OrdersService.CANCELLABLE — once the kitchen has accepted, the food is being
// cooked and the server rejects the cancel (NOT_CANCELLABLE). Keep the two in step.
const CANCELLABLE = new Set(["pending", "confirmed"]);

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null | "error">(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelPrompt, setCancelPrompt] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await apiFetch(`/orders/${id}`);
      if (!res.ok) return setOrder("error");
      setOrder(await res.json());
    } catch {
      setOrder("error");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Story 3.4: a just-paid order stays 'pending' until the payment webhook lands — refresh
  // until it settles (the sweeper cancels truly abandoned ones server-side).
  useEffect(() => {
    if (order !== null && order !== "error" && order.status === "pending") {
      const timer = setTimeout(load, 3000);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  useEffect(() => {
    if (
      !order ||
      order === "error" ||
      ["pending", "cancelled", "declined"].includes(order.status)
    )
      return;
    if (sessionStorage.getItem("checkout_cart_order") === order.id) {
      clearCart();
      sessionStorage.removeItem("checkout_cart_order");
    }
  }, [order]);

  async function cancel() {
    setCancelling(true);
    try {
      const res = await apiFetch(`/orders/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error("Cancellation failed");
      setCancelPrompt(false);
      setActionError(null);
      await load();
    } catch {
      setActionError(
        "We couldn’t cancel this order. It may already be in preparation. Refresh its status and try again.",
      );
    } finally {
      setCancelling(false);
    }
  }

  if (order === null) {
    return (
      <main className={`${styles.page} ${styles.compact}`}>
        <div className="skeleton" style={{ height: 180 }} />
      </main>
    );
  }

  if (order === "error") {
    return (
      <main className={`${styles.page} ${styles.compact}`}>
        <div className="form-error" role="alert">
          Could not load this order. You can only view your own orders.
        </div>
        <Link href="/">‹ Back to home</Link>
      </main>
    );
  }

  const readySlot = new Date(order.readySlot);
  const closed = ["cancelled", "declined"].includes(order.status);
  const stage =
    (
      {
        pending: 0,
        confirmed: 1,
        accepted: 2,
        preparing: 2,
        ready: 3,
        completed: 4,
      } as Record<string, number>
    )[order.status] ?? -1;
  const stages = [
    ["Payment", "Your order begins once payment is confirmed."],
    ["Kitchen confirmation", "The cook will review and accept your order."],
    ["In the kitchen", "Your meal is being prepared."],
    [
      order.fulfillment === "pickup"
        ? "Ready to collect"
        : "Ready for delivery",
      "Freshly made and ready to go.",
    ],
    ["Enjoy your meal", "Your order is complete."],
  ];
  const itemSubtotal = order.items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.qty,
    0,
  );
  return (
    <main className={`${styles.page} ${styles.compact}`}>
      <Link href="/orders" className={styles.back}>
        ← All your orders
      </Link>
      <PageIntro
        eyebrow={`Order · ${order.id.slice(0, 8)}`}
        title={
          closed
            ? "This order is closed."
            : order.status === "pending"
              ? "One last step."
              : order.status === "completed"
                ? "Hope it tasted like home."
                : "Your meal is in good hands."
        }
        description={order.kitchenName}
      >
        <OrderStatus status={order.status} />
      </PageIntro>
      <div className={styles.detailGrid}>
        <div className={styles.stack}>
          {order.status === "pending" && (
            <PaymentStep
              payment={{ orderId: order.id }}
              totalCents={order.totalCents}
            />
          )}
          <section className={styles.panel} aria-label="Order progress">
            <h2>{closed ? "Order update" : "From their kitchen to you"}</h2>
            {closed ? (
              <p className={styles.muted}>
                This order won’t be prepared. You can browse nearby kitchens
                whenever you’re ready for another meal.
              </p>
            ) : (
              <ol className={styles.progress}>
                {stages.map(([label, description], i) => (
                  <li
                    key={label}
                    data-done={i < stage || order.status === "completed"}
                    aria-current={i === stage ? "step" : undefined}
                  >
                    <span aria-hidden="true">
                      {i < stage || order.status === "completed" ? "✓" : i + 1}
                    </span>
                    <div>
                      {label}
                      {i === stage && <small>{description}</small>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <dl className={styles.infoStrip}>
              <div>
                <dt>Ready time</dt>
                <dd>
                  {readySlot.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </dd>
                <p className={styles.muted}>
                  {readySlot.toLocaleDateString([], {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
              <div>
                <dt>Getting your meal</dt>
                <dd>
                  {order.fulfillment === "pickup"
                    ? "Kitchen pickup"
                    : "Delivery to you"}
                </dd>
              </div>
            </dl>
            {!closed &&
              order.fulfillment === "pickup" &&
              order.pickupAddress && (
                <div className={styles.note}>
                  <strong>Order received.</strong>
                  <p>Collect your meal {order.pickupTimeZone
                    ? pickupDay(order.readySlot.slice(0, 10), order.pickupTimeZone)
                    : readySlot.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })} at {order.readySlot.slice(11, 16)} (kitchen time).</p>
                  <strong>Pickup address</strong>
                  <br />
                  <address style={{ fontStyle: "normal" }}>{order.pickupAddress}</address>
                  <p><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.pickupAddress)}`} target="_blank" rel="noreferrer">Get directions →</a></p>
                </div>
              )}
            {!closed &&
              order.status !== "completed" &&
              order.fulfillment === "delivery" && (
                <div className={styles.note}>
                  {order.deliveryJob?.trackingUrl ? (
                    <a
                      href={order.deliveryJob.trackingUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Track your courier →
                    </a>
                  ) : (
                    "Your courier tracking link will appear here when the kitchen marks your meal ready."
                  )}
                </div>
              )}
            {order.refundedAt && (
              <div className={styles.note}>
                {money(order.totalCents)} refunded ·{" "}
                {new Date(order.refundedAt).toLocaleDateString()}
              </div>
            )}
            {!closed && order.status !== "completed" && (
              <button className={styles.secondary} onClick={load}>
                Refresh status
              </button>
            )}
          </section>
          {order.status === "completed" && <ReviewCard order={order} />}
        </div>
        <aside className={styles.stack}>
          <section className={styles.panel}>
            <h2>On your table</h2>
            {order.items.map((it) => (
              <div key={it.id} className={styles.receiptItem}>
                {it.menuItem.dish.photo && (
                  <img
                    src={it.menuItem.dish.photo}
                    alt={it.menuItem.dish.name}
                  />
                )}
                <span>
                  {it.qty} × {it.menuItem.dish.name}
                </span>
                <strong>{money(it.unitPriceCents * it.qty)}</strong>
              </div>
            ))}
            {order.totalCents !== itemSubtotal && (
              <div className={styles.receiptItem}>
                <span>Delivery &amp; tip</span>
                <strong>{money(order.totalCents - itemSubtotal)}</strong>
              </div>
            )}
            <div className={styles.receiptTotal}>
              <strong>Total</strong>
              <strong>{money(order.totalCents)}</strong>
            </div>
            <p className={styles.muted}>
              Ordered{" "}
              {new Date(order.createdAt).toLocaleDateString([], {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </section>
          {CANCELLABLE.has(order.status) && (
            <div>
              {cancelPrompt ? (
                <div className={styles.note}>
                  <p>
                    Cancel this order? Your reserved portions will be released.
                  </p>
                  <div className={styles.actions}>
                    <button
                      className={styles.danger}
                      onClick={cancel}
                      disabled={cancelling}
                    >
                      {cancelling ? "Cancelling…" : "Yes, cancel order"}
                    </button>
                    <button
                      className={styles.secondary}
                      disabled={cancelling}
                      onClick={() => setCancelPrompt(false)}
                    >
                      Keep order
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className={styles.danger}
                  onClick={() => setCancelPrompt(true)}
                >
                  Cancel order
                </button>
              )}
              {actionError && (
                <p className="form-error" role="alert">
                  {actionError}
                </p>
              )}
            </div>
          )}
          <Link href="/" className={styles.textLink}>
            Explore nearby kitchens →
          </Link>
        </aside>
      </div>
    </main>
  );
}

/** Story 6.1 (FR16) — rate the kitchen once the order is completed, once per order. */
function ReviewCard({ order }: { order: OrderDetail }) {
  const [existing, setExisting] = useState<Review | null | undefined>(
    undefined,
  );
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/orders/${order.id}/review`)
      .then(
        async (res) =>
          !cancelled && setExisting(res.ok ? await res.json() : null),
      )
      .catch(() => !cancelled && setExisting(null));
    return () => {
      cancelled = true;
    };
  }, [order.id]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/kitchens/${order.kitchenId}/reviews`, {
        method: "POST",
        body: JSON.stringify({
          orderId: order.id,
          rating,
          comment: comment.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          body.message === "ALREADY_REVIEWED"
            ? "You already reviewed this order."
            : body.message === "REVIEW_WINDOW_EXPIRED"
              ? `The ${REVIEW_WINDOW_MONTHS}-month window to rate this order has closed.`
              : "Could not submit your review — try again.",
        );
        return;
      }
      setExisting(await res.json());
    } finally {
      setBusy(false);
    }
  }

  if (existing === undefined) return null; // still checking

  const withinWindow = isWithinReviewWindow(order.createdAt);

  if (existing) {
    return (
      <div className="card" style={{ marginBottom: 16, textAlign: "center" }}>
        <div
          style={{ fontSize: 22, letterSpacing: 2 }}
          aria-label={`Your rating: ${existing.rating} of 5`}
        >
          {"★".repeat(existing.rating)}
          <span style={{ color: "var(--brand-border)" }}>
            {"★".repeat(5 - existing.rating)}
          </span>
        </div>
        {existing.comment && (
          <p style={{ margin: "8px 0 0", fontStyle: "italic" }}>
            “{existing.comment}”
          </p>
        )}
        <p
          style={{
            margin: "8px 0 0",
            color: "var(--brand-muted)",
            fontSize: 14,
          }}
        >
          Thanks for reviewing {order.kitchenName}!
        </p>
      </div>
    );
  }

  if (!withinWindow) {
    return (
      <div className="card" style={{ marginBottom: 16, textAlign: "center" }}>
        <p style={{ margin: 0, color: "var(--brand-muted)", fontSize: 14 }}>
          The {REVIEW_WINDOW_MONTHS}-month window to rate this order has closed.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <strong>How was {order.kitchenName}?</strong>
      <div style={{ margin: "10px 0" }} role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 30,
              cursor: "pointer",
              padding: "0 2px",
              color:
                n <= (hover || rating)
                  ? "var(--brand-orange)"
                  : "var(--brand-border)",
            }}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        className="field"
        rows={3}
        maxLength={1000}
        placeholder="What did you love? (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        style={{ resize: "vertical", fontFamily: "inherit" }}
      />
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <button
        className="btn-primary"
        disabled={busy || rating === 0}
        onClick={submit}
      >
        {busy ? "Submitting…" : "Submit review"}
      </button>
    </div>
  );
}
