"use client";

/** Order history — the buyer's own orders, newest first (GET /orders). Each row links to
 * the order detail page; active orders float to the top band, and completed-but-unreviewed
 * orders show a "rate it" nudge (Story 6.1). */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, ensureSession, Session } from "../../lib/api";
import { CUISINE_ICONS } from "../../lib/cuisines";
import { money } from "../../lib/cart";

interface OrderRow {
  id: string;
  status: string;
  readySlot: string;
  fulfillment: string;
  totalCents: number;
  createdAt: string;
  kitchenName: string;
  cuisineTag: string;
  itemsSummary: string | null;
  deliveryTrackingUrl: string | null;
  reviewed: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Payment processing…",
  confirmed: "Waiting for the kitchen",
  accepted: "Accepted",
  preparing: "Being prepared",
  ready: "Ready",
  completed: "Completed",
  declined: "Declined",
  cancelled: "Cancelled",
};

const ACTIVE = new Set(["pending", "confirmed", "accepted", "preparing", "ready"]);

export default function OrdersPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [orders, setOrders] = useState<OrderRow[] | null | undefined>(undefined);

  useEffect(() => {
    ensureSession().then((s) => {
      setSession(s);
      if (!s) router.replace("/login?next=/orders");
    });
  }, [router]);

  useEffect(() => {
    if (!session) return;
    apiFetch("/orders")
      .then(async (res) => setOrders(res.ok ? await res.json() : null))
      .catch(() => setOrders(null));
  }, [session]);

  if (session === undefined || (session && orders === undefined)) {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
        <div className="skeleton" style={{ height: 180 }} />
      </main>
    );
  }

  if (!session) return null; // redirecting to /login

  if (orders === null) {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
        <div className="form-error" role="alert">
          Could not load your orders — try again in a moment.
        </div>
        <Link href="/">‹ Back home</Link>
      </main>
    );
  }

  const active = orders.filter((o) => ACTIVE.has(o.status));
  const past = orders.filter((o) => !ACTIVE.has(o.status));

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 26, color: "var(--brand-green)" }}>Your orders</h1>
      <p style={{ margin: "0 0 20px", color: "var(--brand-muted)" }}>
        Every order you&rsquo;ve placed, newest first.
      </p>

      {orders.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <p style={{ fontSize: 36, margin: 0 }}>🍲</p>
          <p style={{ fontWeight: 600, margin: "8px 0 4px" }}>No orders yet</p>
          <p style={{ color: "var(--brand-muted)", margin: "0 0 16px" }}>
            Find a kitchen near you and order something delicious.
          </p>
          <Link href="/" className="btn-primary" style={{ width: "auto", textDecoration: "none" }}>
            Browse kitchens
          </Link>
        </div>
      )}

      {active.length > 0 && (
        <>
          <h2 style={{ fontSize: 18, color: "var(--brand-green)", margin: "0 0 10px" }}>In progress</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
            {active.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </div>
        </>
      )}

      {past.length > 0 && (
        <>
          {active.length > 0 && (
            <h2 style={{ fontSize: 18, color: "var(--brand-green)", margin: "0 0 10px" }}>Past orders</h2>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {past.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function OrderCard({ order }: { order: OrderRow }) {
  const icon = CUISINE_ICONS[order.cuisineTag] ?? "🍽️";
  const placed = new Date(order.createdAt);
  const needsReview = order.status === "completed" && !order.reviewed;

  return (
    <Link
      href={`/orders/${order.id}`}
      className="card"
      style={{ display: "block", textDecoration: "none", color: "inherit", padding: "14px 18px" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <strong style={{ fontSize: 16 }}>
          {icon} {order.kitchenName}
        </strong>
        <strong>{money(order.totalCents)}</strong>
      </div>
      {order.itemsSummary && (
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 14,
            color: "var(--brand-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {order.itemsSummary}
        </p>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        <span className="badge portions">{STATUS_LABEL[order.status] ?? order.status}</span>
        <span style={{ fontSize: 12, color: "var(--brand-muted)", textTransform: "capitalize" }}>
          {order.fulfillment}
        </span>
        <span style={{ fontSize: 12, color: "var(--brand-muted)" }}>
          · {placed.toLocaleDateString()}{" "}
          {placed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
        {needsReview && <span className="badge hygiene">★ Rate this order</span>}
        {order.deliveryTrackingUrl && ACTIVE.has(order.status) && (
          <span
            role="link"
            tabIndex={0}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(order.deliveryTrackingUrl!, "_blank", "noopener,noreferrer");
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              window.open(order.deliveryTrackingUrl!, "_blank", "noopener,noreferrer");
            }}
            style={{
              fontSize: 12,
              color: "var(--brand-blue, #0081c8)",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            Courier on the way →
          </span>
        )}
      </div>
    </Link>
  );
}
