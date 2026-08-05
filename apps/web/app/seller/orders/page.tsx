"use client";

/** Seller Today Board — front-end-spec.md (Story 4.1, FR11/FR22).
 * Columns by status: New (confirmed) → Accepted → Preparing → Ready → Done.
 * Cards show ready-time, items, fulfillment mode; New orders carry a 10-minute
 * respond countdown (visual nudge — the API doesn't auto-decline), decline needs a
 * second confirming tap, and delivery orders grow a partner status chip + tracking
 * link once the courier job exists (created when the order is marked Ready). */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ensureSession, Session } from "../../../lib/api";
import { money } from "../../../lib/cart";

interface OrderLineItem {
  name: string;
  qty: number;
  photo: string | null;
}

interface SellerOrder {
  id: string;
  status: string;
  readySlot: string; // LocalDateTime, e.g. "2026-07-07T18:00:00"
  fulfillment: "pickup" | "delivery";
  totalCents: number;
  deliveryFeeCents: number;
  tipCents: number;
  createdAt: string;
  itemsSummary: string | null;
  items: OrderLineItem[];
  buyerEmail: string;
  buyerPhone: string | null;
  deliveryProvider: string | null;
  deliveryStatus: string | null;
  deliveryTrackingUrl: string | null;
}

const COLUMNS: { status: string; title: string }[] = [
  { status: "confirmed", title: "New" },
  { status: "accepted", title: "Accepted" },
  { status: "preparing", title: "Preparing" },
  { status: "ready", title: "Ready" },
  { status: "completed", title: "Done" },
];

const EMPTY_COLUMN_ICON: Record<string, string> = {
  confirmed: "📭",
  accepted: "🙌",
  preparing: "🍳",
  ready: "🛎️",
  completed: "🎉",
};

/** FR11 "accept/decline within a time limit" — the board's respond window. */
const RESPOND_SECONDS = 10 * 60;
const POLL_MS = 15000;

// readySlot/menuDay dates are all UTC-day-based server-side (see CLAUDE.md's daily-menu
// trap); using the browser's local calendar date here caused the board to show empty
// once local time crossed midnight while the order was still "today" in UTC.
const localToday = () => new Date().toISOString().slice(0, 10);

const slotTime = (isoLocal: string) =>
  new Date(isoLocal).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function SellerOrdersPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [kitchenId, setKitchenId] = useState<string | null | undefined>(undefined);
  const [orders, setOrders] = useState<SellerOrder[] | undefined>(undefined);
  const [date, setDate] = useState(localToday());
  const [now, setNow] = useState(Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureSession().then((s) => {
      setSession(s);
      if (!s) router.replace("/login?next=/seller/orders");
    });
  }, [router]);

  useEffect(() => {
    if (session?.role !== "seller") return;
    apiFetch("/kitchens/mine").then(async (res) => {
      setKitchenId(res.ok ? (await res.json()).id : null);
    });
  }, [session]);

  const load = useCallback(async () => {
    if (!kitchenId) return;
    const res = await apiFetch(`/kitchens/${kitchenId}/orders`);
    if (res.ok) setOrders(await res.json());
  }, [kitchenId]);

  // Board data: initial load + 15 s polling (matches the notification bell cadence-ish).
  useEffect(() => {
    if (!kitchenId) return;
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [kitchenId, load]);

  // 1 s tick drives the respond countdowns.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function act(orderId: string, action: string) {
    setBusyId(orderId);
    setError(null);
    try {
      const res = await apiFetch(`/orders/${orderId}/${action}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          typeof body.message === "string" && body.message.startsWith("INVALID_TRANSITION")
            ? "This order changed in the meantime — refreshing the board."
            : "Could not update the order — try again.",
        );
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (session === undefined || (session?.role === "seller" && kitchenId === undefined)) {
    return (
      <main style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
        <div className="skeleton" style={{ height: 220 }} />
      </main>
    );
  }

  if (!session) return null; // redirecting to /login

  if (session.role !== "seller") {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
        <div className="form-error" role="alert">
          This page is for sellers. You are signed in as a {session.role}.
        </div>
        <Link href="/">‹ Back home</Link>
      </main>
    );
  }

  if (kitchenId === null) {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <p style={{ fontSize: 36, margin: 0 }}>🏠</p>
          <p style={{ fontWeight: 600, margin: "8px 0 4px" }}>Set up your kitchen first</p>
          <p style={{ color: "var(--brand-muted)", margin: "0 0 16px" }}>
            Orders arrive once you have a kitchen and a published menu.
          </p>
          <Link href="/seller/menu" className="btn-primary" style={{ width: "auto", textDecoration: "none" }}>
            Go to kitchen setup
          </Link>
        </div>
      </main>
    );
  }

  const dayOrders = (orders ?? []).filter((o) => o.readySlot.slice(0, 10) === date);
  const closed = dayOrders.filter((o) => o.status === "declined" || o.status === "cancelled");
  const active = dayOrders.filter((o) => COLUMNS.some((c) => c.status === o.status));
  const revenueCents = active.reduce((sum, o) => sum + o.totalCents, 0);
  const needsResponse = active.filter((o) => o.status === "confirmed").length;

  return (
    <main style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: 26, color: "var(--brand-green)" }}>Today&rsquo;s Orders</h1>
          <p style={{ margin: 0, color: "var(--brand-muted)" }}>
            Accept new orders, then move them across as you cook. Buyers are notified at every step.
          </p>
        </div>
        <input
          type="date"
          className="field"
          style={{ width: "auto", margin: 0 }}
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          aria-label="Board date"
        />
      </div>

      {orders !== undefined && (
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            marginTop: 18,
          }}
          aria-label="Daily summary"
        >
          {[
            { label: "Orders", value: String(active.length), icon: "🧾" },
            { label: "Revenue", value: money(revenueCents), icon: "💰" },
            {
              label: "Avg order",
              value: active.length ? money(Math.round(revenueCents / active.length)) : "—",
              icon: "📊",
            },
            { label: "Need response", value: String(needsResponse), icon: needsResponse > 0 ? "⏳" : "✅" },
          ].map((s) => (
            <div
              key={s.label}
              className="card"
              style={{
                flex: "1 1 140px",
                padding: "12px 16px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                margin: 0,
              }}
            >
              <span style={{ fontSize: 22 }}>{s.icon}</span>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.1 }}>{s.value}</div>
                <div style={{ fontSize: 12, color: "var(--brand-muted)" }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="form-error" role="alert" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}

      {orders === undefined ? (
        <div className="board" style={{ marginTop: 20 }}>
          {COLUMNS.map((c) => (
            <div key={c.status} className="skeleton" style={{ height: 160 }} />
          ))}
        </div>
      ) : active.length === 0 && closed.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40, marginTop: 20 }}>
          <p style={{ fontSize: 36, margin: 0 }}>🍳</p>
          <p style={{ fontWeight: 600, margin: "8px 0 4px" }}>No orders for this day yet</p>
          <p style={{ color: "var(--brand-muted)", margin: 0 }}>
            Make sure your <Link href="/seller/menu">menu is published</Link> — new orders appear here the
            moment they&rsquo;re paid.
          </p>
        </div>
      ) : (
        <div className="board" style={{ marginTop: 20 }} aria-label="Orders by status">
          {COLUMNS.map((col) => {
            const cards = active
              .filter((o) => o.status === col.status)
              .sort((a, b) => a.readySlot.localeCompare(b.readySlot));
            return (
              <section key={col.status} className="board-col" aria-label={`${col.title} orders`}>
                <h3>
                  {col.title}
                  <span className="badge portions">{cards.length}</span>
                </h3>
                {cards.length === 0 && (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "18px 8px",
                      color: "var(--brand-muted)",
                      fontSize: 12,
                      border: "1px dashed var(--brand-border)",
                      borderRadius: 10,
                    }}
                  >
                    <div style={{ fontSize: 20, marginBottom: 2 }}>{EMPTY_COLUMN_ICON[col.status] ?? "🍽️"}</div>
                    Nothing here yet
                  </div>
                )}
                {cards.map((o) => (
                  <OrderCard key={o.id} order={o} now={now} busy={busyId === o.id} onAct={act} />
                ))}
              </section>
            );
          })}
        </div>
      )}

      {closed.length > 0 && (
        <details style={{ marginTop: 20 }}>
          <summary style={{ cursor: "pointer", color: "var(--brand-muted)", fontSize: 14 }}>
            Declined / cancelled ({closed.length})
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10, maxWidth: 560 }}>
            {closed.map((o) => (
              <div key={o.id} className="order-card" style={{ opacity: 0.7, marginBottom: 0 }}>
                <span className="slot">⏰ {slotTime(o.readySlot)}</span>{" "}
                <span className="badge soldout">{o.status}</span>
                <div style={{ marginTop: 4, color: "var(--brand-muted)" }}>{o.itemsSummary}</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </main>
  );
}

function OrderCard({
  order,
  now,
  busy,
  onAct,
}: {
  order: SellerOrder;
  now: number;
  busy: boolean;
  onAct: (orderId: string, action: string) => void;
}) {
  // Spec: "declined-order confirmation" — first tap arms, second tap declines.
  const [armDecline, setArmDecline] = useState(false);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(disarmTimer.current), []);

  const secondsLeft = RESPOND_SECONDS - Math.floor((now - new Date(order.createdAt).getTime()) / 1000);

  function decline() {
    if (!armDecline) {
      setArmDecline(true);
      disarmTimer.current = setTimeout(() => setArmDecline(false), 4000);
      return;
    }
    clearTimeout(disarmTimer.current);
    setArmDecline(false);
    onAct(order.id, "decline");
  }

  return (
    <article className="order-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span className="slot">⏰ {slotTime(order.readySlot)}</span>
        <span style={{ fontSize: 12, color: "var(--brand-muted)" }}>
          {order.fulfillment === "delivery" ? "🚗 Delivery" : "🛍 Pickup"}
        </span>
      </div>

      <p style={{ margin: "6px 0 4px", fontSize: 13, color: "var(--brand-muted)" }}>
        👤 {order.buyerEmail}
        {order.buyerPhone && <> · 📞 {order.buyerPhone}</>}
      </p>

      {order.items.length > 0 ? (
        <ul style={{ listStyle: "none", margin: "0 0 8px", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {order.items.map((it, i) => (
            <li key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {it.photo ? (
                <img
                  src={it.photo}
                  alt=""
                  style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
                />
              ) : (
                <span style={{ fontSize: 16, width: 28, textAlign: "center", flexShrink: 0 }}>🍽️</span>
              )}
              <span style={{ fontSize: 13.5 }}>
                {it.name} <span style={{ color: "var(--brand-muted)" }}>×{it.qty}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ margin: "6px 0" }}>{order.itemsSummary ?? "—"}</p>
      )}

      {(order.deliveryFeeCents > 0 || order.tipCents > 0) && (
        <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--brand-muted)" }}>
          {order.deliveryFeeCents > 0 && <>Delivery {money(order.deliveryFeeCents)}</>}
          {order.deliveryFeeCents > 0 && order.tipCents > 0 && " · "}
          {order.tipCents > 0 && <>Tip {money(order.tipCents)}</>}
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong>{money(order.totalCents)}</strong>
        {order.status === "confirmed" &&
          (secondsLeft > 0 ? (
            <span className="badge countdown" aria-label="Time left to respond">
              ⏳ {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
            </span>
          ) : (
            <span className="badge overdue">Response overdue</span>
          ))}
      </div>

      {order.deliveryStatus && (
        <div style={{ marginBottom: 8 }}>
          <span className="badge hygiene">
            🚗 {order.deliveryProvider} · {order.deliveryStatus.replace(/_/g, " ")}
          </span>{" "}
          {order.deliveryTrackingUrl && (
            <a href={order.deliveryTrackingUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
              Track
            </a>
          )}
        </div>
      )}

      {order.status === "confirmed" && (
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-accept" disabled={busy} onClick={() => onAct(order.id, "accept")}>
            Accept
          </button>
          <button
            className={`btn-decline${armDecline ? " arm" : ""}`}
            disabled={busy}
            onClick={decline}
            aria-label={armDecline ? "Tap again to confirm decline" : "Decline order"}
          >
            {armDecline ? "Really decline?" : "Decline"}
          </button>
        </div>
      )}
      {order.status === "accepted" && (
        <button className="btn-advance" disabled={busy} onClick={() => onAct(order.id, "preparing")}>
          Start preparing
        </button>
      )}
      {order.status === "preparing" && (
        <button className="btn-advance" disabled={busy} onClick={() => onAct(order.id, "ready")}>
          Mark ready
        </button>
      )}
      {order.status === "ready" && (
        <button className="btn-advance" disabled={busy} onClick={() => onAct(order.id, "complete")}>
          {order.fulfillment === "delivery" ? "Handed to courier" : "Picked up — complete"}
        </button>
      )}
    </article>
  );
}
