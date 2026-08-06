"use client";

/** Order confirmation & tracking (front-end-spec.md Order Tracking, FR10). The pickup street
 * address is only present here once the order is placed — the server withholds it otherwise. */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { money } from "../../../lib/cart";
import { isWithinReviewWindow, REVIEW_WINDOW_MONTHS } from "../../../lib/reviewWindow";

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
  deliveryJob: DeliveryJob | null;
}

interface Review {
  rating: number;
  comment: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Payment processing…",
  confirmed: "Confirmed — waiting for the kitchen to accept",
  accepted: "Accepted by the kitchen",
  preparing: "Being prepared",
  ready: "Ready",
  completed: "Completed",
  declined: "Declined by the kitchen",
  cancelled: "Cancelled",
};

const FINAL = new Set(["completed", "cancelled", "declined"]);

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null | "error">(null);
  const [cancelling, setCancelling] = useState(false);

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

  async function cancel() {
    setCancelling(true);
    try {
      await apiFetch(`/orders/${id}/cancel`, { method: "POST" });
      await load();
    } finally {
      setCancelling(false);
    }
  }

  if (order === null) {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 24px" }}>
        <div className="skeleton" style={{ height: 180 }} />
      </main>
    );
  }

  if (order === "error") {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 24px" }}>
        <div className="form-error" role="alert">
          Could not load this order. You can only view your own orders.
        </div>
        <Link href="/">‹ Back to home</Link>
      </main>
    );
  }

  const readySlot = new Date(order.readySlot);

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 24px" }}>
      <div className="card" style={{ textAlign: "center", padding: "28px 24px", marginBottom: 16 }}>
        <p style={{ fontSize: 40, margin: 0 }}>{order.status === "pending" ? "⏳" : "🎉"}</p>
        <h1 style={{ margin: "8px 0 4px", fontSize: 22, color: "var(--brand-green)" }}>
          {order.status === "pending" ? "Finishing your payment…" : "Order placed!"}
        </h1>
        <p style={{ color: "var(--brand-muted)", margin: 0 }}>{order.kitchenName}</p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className="badge portions">{STATUS_LABEL[order.status] ?? order.status}</span>
          {/* FR21 — captured payments come back automatically on decline/cancel. */}
          {order.refundedAt && (
            <span className="badge hygiene">
              💸 {money(order.totalCents)} refunded · {new Date(order.refundedAt).toLocaleDateString()}
            </span>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ color: "var(--brand-muted)" }}>Ready at</span>
          <strong>
            {readySlot.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ color: "var(--brand-muted)" }}>Fulfillment</span>
          <strong style={{ textTransform: "capitalize" }}>{order.fulfillment}</strong>
        </div>

        {order.fulfillment === "pickup" && order.pickupAddress && (
          <div style={{ marginTop: 10, padding: 12, background: "#fdf0e3", borderRadius: 10 }}>
            <div style={{ fontSize: 13, color: "var(--brand-muted)" }}>Pickup address</div>
            <strong>{order.pickupAddress}</strong>
          </div>
        )}

        {order.fulfillment === "delivery" && (
          <div style={{ marginTop: 10, padding: 12, background: "#fdf0e3", borderRadius: 10 }}>
            {order.deliveryJob?.trackingUrl ? (
              <a href={order.deliveryJob.trackingUrl} target="_blank" rel="noreferrer">
                Track your courier →
              </a>
            ) : (
              <span style={{ color: "var(--brand-muted)", fontSize: 14 }}>
                A courier tracking link appears once the kitchen marks your order ready.
              </span>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        {order.items.map((it) => (
          <div key={it.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
            <span>
              {it.qty} × {it.menuItem.dish.name}
            </span>
            <strong>{money(it.unitPriceCents * it.qty)}</strong>
          </div>
        ))}
        <hr style={{ border: "none", borderTop: "1px solid var(--brand-border)", margin: "10px 0" }} />
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <strong>Total</strong>
          <strong>{money(order.totalCents)}</strong>
        </div>
      </div>

      {order.status === "completed" && <ReviewCard order={order} />}

      {!FINAL.has(order.status) && (
        <button
          onClick={cancel}
          disabled={cancelling}
          style={{
            width: "100%",
            padding: "12px 20px",
            background: "transparent",
            border: "1px solid var(--brand-border)",
            borderRadius: 10,
            fontSize: 15,
            cursor: "pointer",
            color: "#b91c1c",
          }}
        >
          {cancelling ? "Cancelling…" : "Cancel order"}
        </button>
      )}
      <p style={{ textAlign: "center", marginTop: 16 }}>
        <Link href="/">Back to nearby kitchens</Link>
      </p>
    </main>
  );
}

/** Story 6.1 (FR16) — rate the kitchen once the order is completed, once per order. */
function ReviewCard({ order }: { order: OrderDetail }) {
  const [existing, setExisting] = useState<Review | null | undefined>(undefined);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/orders/${order.id}/review`)
      .then(async (res) => !cancelled && setExisting(res.ok ? await res.json() : null))
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
        body: JSON.stringify({ orderId: order.id, rating, comment: comment.trim() || undefined }),
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
        <div style={{ fontSize: 22, letterSpacing: 2 }} aria-label={`Your rating: ${existing.rating} of 5`}>
          {"★".repeat(existing.rating)}
          <span style={{ color: "var(--brand-border)" }}>{"★".repeat(5 - existing.rating)}</span>
        </div>
        {existing.comment && <p style={{ margin: "8px 0 0", fontStyle: "italic" }}>“{existing.comment}”</p>}
        <p style={{ margin: "8px 0 0", color: "var(--brand-muted)", fontSize: 14 }}>
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
              color: n <= (hover || rating) ? "var(--brand-orange)" : "var(--brand-border)",
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
      <button className="btn-primary" disabled={busy || rating === 0} onClick={submit}>
        {busy ? "Submitting…" : "Submit review"}
      </button>
    </div>
  );
}
