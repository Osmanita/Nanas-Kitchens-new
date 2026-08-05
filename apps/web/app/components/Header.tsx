"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiFetch, getSession, logout, Session } from "../../lib/api";

interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: { orderId?: string; trackingUrl?: string; kitchenId?: string } | null;
  readAt: string | null;
  createdAt: string;
}

export default function Header() {
  const [session, setSession] = useState<Session | null>(null);
  const router = useRouter();

  useEffect(() => {
    const sync = () => setSession(getSession());
    sync();
    window.addEventListener("session-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("session-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return (
    <>
      <header
        className="island-nav"
        style={{ maxWidth: 1100, margin: "0 auto", flexWrap: "wrap", rowGap: 10 }}
      >
        <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 19, fontWeight: 800, color: "var(--text)" }}>Nanas&rsquo;</span>
          <span className="hero-em" style={{ fontSize: 19, fontWeight: 800 }}>
            Kitchens
          </span>
        </Link>
        <nav style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14.5 }}>
          <Link href="/" className="chip" style={{ border: "none", background: "transparent" }}>
            Home
          </Link>
          <Link href="/chat" className="chip" style={{ border: "none", background: "transparent" }}>
            Chat
          </Link>
          {session?.role === "buyer" && (
            <Link href="/orders" className="chip" style={{ border: "none", background: "transparent" }}>
              My Orders
            </Link>
          )}
          {session?.role === "seller" && (
            <>
              <Link href="/seller/orders" className="chip" style={{ border: "none", background: "transparent" }}>
                Orders
              </Link>
              <Link href="/seller/menu" className="chip" style={{ border: "none", background: "transparent" }}>
                My Menu
              </Link>
              <Link href="/seller/kitchen" className="chip" style={{ border: "none", background: "transparent" }}>
                My Kitchen
              </Link>
              <Link href="/seller/earnings" className="chip" style={{ border: "none", background: "transparent" }}>
                Earnings
              </Link>
            </>
          )}
          {session?.role === "inspector" && (
            <Link href="/inspector/visits" className="chip" style={{ border: "none", background: "transparent" }}>
              Visits
            </Link>
          )}
          {session?.role === "admin" && (
            <Link href="/admin" className="chip" style={{ border: "none", background: "transparent" }}>
              Admin
            </Link>
          )}

          {session ? (
            <>
              <NotificationBell session={session} />
              <span
                style={{
                  background: "var(--accent-soft)",
                  color: "var(--accent)",
                  borderRadius: 999,
                  padding: "4px 12px",
                  fontSize: 12.5,
                  fontWeight: 700,
                  textTransform: "capitalize",
                }}
              >
                {session.role}
              </span>
              <button
                onClick={() => {
                  logout();
                  router.push("/");
                }}
                className="btn-ghost"
                style={{ padding: "7px 16px", fontSize: 13.5 }}
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="chip" style={{ border: "none", background: "transparent" }}>
                Log in
              </Link>
              <Link href="/register" className="btn btn-primary" style={{ padding: "9px 20px", fontSize: 14 }}>
                Sign up
              </Link>
            </>
          )}
        </nav>
      </header>
      {/* Reserves the space the fixed header would otherwise cover — a plain spacer
          div rather than scroll-margin since the header height varies with nav wrapping. */}
      <div style={{ height: 78 }} aria-hidden="true" />
    </>
  );
}

/** Story 4.4 (FR22) — in-app notification inbox. Polls every 30 s; opening the panel
 * marks everything read. Buyer notifications deep-link to the order page; seller
 * order notifications deep-link to the Today Board (Story 4.1). */
function NotificationBell({ session }: { session: Session }) {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    try {
      const res = await apiFetch("/notifications");
      if (!res.ok) return;
      const body = await res.json();
      setUnread(body.unreadCount);
      setItems(body.notifications);
    } catch {
      /* API down — badge just goes stale */
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.userId]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      await apiFetch("/notifications/read", { method: "POST" }).catch(() => {});
      setUnread(0);
    }
  }

  return (
    <div ref={panelRef} style={{ position: "relative" }}>
      <button className="bell" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`} onClick={toggle}>
        🔔
        {unread > 0 && <span className="bell-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="menu" aria-label="Notifications">
          {items.length === 0 && (
            <p style={{ padding: 16, margin: 0, color: "var(--brand-muted)", fontSize: 14 }}>
              Nothing yet — order something delicious!
            </p>
          )}
          {items.map((n) => {
            const time = new Date(n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            const inner = (
              <>
                <strong style={{ fontSize: 14 }}>{n.title}</strong>
                <span style={{ fontSize: 13, color: "var(--brand-muted)" }}>{n.body}</span>
                <span style={{ fontSize: 11, color: "var(--brand-muted)" }}>{time}</span>
              </>
            );
            // Deep-link by role: buyers to the order/kitchen, sellers to the board or
            // (for dish requests, which carry only kitchenId) their menu inbox.
            const href =
              session.role === "buyer"
                ? n.data?.orderId
                  ? `/orders/${n.data.orderId}`
                  : n.data?.kitchenId
                    ? `/kitchens/${n.data.kitchenId}`
                    : null
                : session.role === "seller"
                  ? n.data?.orderId
                    ? "/seller/orders"
                    : n.data?.kitchenId
                      ? "/seller/menu"
                      : null
                  : null;
            return href ? (
              <Link
                key={n.id}
                href={href}
                className={`notif-item${n.readAt ? "" : " unread"}`}
                onClick={() => setOpen(false)}
              >
                {inner}
              </Link>
            ) : (
              <div key={n.id} className={`notif-item${n.readAt ? "" : " unread"}`}>
                {inner}
              </div>
            );
          })}
          <Link
            href="/settings/notifications"
            onClick={() => setOpen(false)}
            style={{
              display: "block",
              padding: "10px 14px",
              fontSize: 13,
              textAlign: "center",
              color: "var(--brand-muted)",
              borderTop: "1px solid var(--brand-border)",
            }}
          >
            ⚙ Notification settings
          </Link>
        </div>
      )}
    </div>
  );
}
