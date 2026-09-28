"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiFetch, getSession, logout, Session } from "../../lib/api";
import Icon from "./Icon";
import SellerNav from "./SellerNav";
import styles from "./Header.module.css";

interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: { orderId?: string; trackingUrl?: string; kitchenId?: string; pollId?: string } | null;
  readAt: string | null;
  createdAt: string;
}

export default function Header() {
  const [session, setSession] = useState<Session | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const revealCurrent = () => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active || nav.scrollWidth <= nav.clientWidth) return;
      const item = active.getBoundingClientRect();
      const container = nav.getBoundingClientRect();
      nav.scrollLeft += item.left - container.left - (nav.clientWidth - item.width) / 2;
    };
    revealCurrent();
    const observer = new ResizeObserver(revealCurrent);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [pathname, session?.role]);

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

  const links = [
    { href: "/", label: session?.role === "seller" ? "Marketplace" : "Home" },
    { href: "/chat", label: "Chat" },
    ...(session?.role === "buyer"
      ? [{ href: "/voting", label: "Tomorrow’s menu" }]
      : []),
    ...(session?.role === "buyer"
      ? [{ href: "/orders", label: "My orders" }]
      : []),
    ...(session?.role === "seller"
      ? [
          { href: "/seller", label: "Seller portal" },
        ]
      : []),
    ...(session?.role === "inspector"
      ? [{ href: "/inspector/visits", label: "Visits" }]
      : []),
    ...(session?.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <>
      <a className={styles.skip} href="#main-content">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.inner}>
          <Link
            href="/"
            className={styles.brand}
            aria-label="Nanas’ Kitchens home"
          >
            <span className={styles.mark}>
              <Icon name="bowl" />
            </span>
            <span>
              Nanas&rsquo; <em>Kitchens</em>
              {process.env.NEXT_PUBLIC_PREVIEW_MODE === "1" && (
                <small className={styles.preview}>Private beta · Test payments only</small>
              )}
            </span>
          </Link>
          <nav ref={navRef} className={styles.links} aria-label="Main navigation">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={styles.link}
                aria-current={
                  pathname === href ||
                  (href === "/seller" && pathname === "/voting") ||
                  (href !== "/" && pathname.startsWith(`${href}/`))
                    ? "page"
                    : undefined
                }
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className={styles.actions}>
            {session ? (
              <>
                <NotificationBell session={session} />
                <span className={styles.role}>{session.role}</span>
                <button
                  onClick={() => {
                    logout();
                    router.push("/");
                  }}
                  className={styles.logout}
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className={styles.link}>
                  Log in
                </Link>
                <Link href="/register" className={styles.signup}>
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      {session?.role === "seller" && (pathname === "/seller" || pathname.startsWith("/seller/") || pathname === "/voting") && <SellerNav />}
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
  }, [session.userId]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node))
        setOpen(false);
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
      <button
        className="bell"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name="bell" />
        {unread > 0 && (
          <span className="bell-badge">{unread > 9 ? "9+" : unread}</span>
        )}
      </button>
      {open && (
        <div className="notif-panel" role="menu" aria-label="Notifications">
          {items.length === 0 && (
            <p
              style={{
                padding: 16,
                margin: 0,
                color: "var(--brand-muted)",
                fontSize: 14,
              }}
            >
              Nothing yet — order something delicious!
            </p>
          )}
          {items.map((n) => {
            const time = new Date(n.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });
            const inner = (
              <>
                <strong style={{ fontSize: 14 }}>{n.title}</strong>
                <span style={{ fontSize: 13, color: "var(--brand-muted)" }}>
                  {n.body}
                </span>
                <span style={{ fontSize: 11, color: "var(--brand-muted)" }}>
                  {time}
                </span>
              </>
            );
            // Deep-link by role: buyers to the order/kitchen, sellers to the board or
            // (for dish requests, which carry only kitchenId) their menu inbox.
            const href = n.data?.pollId ? (session.role === "buyer" ? "/voting?tab=preorders" : "/voting") :
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
              <div
                key={n.id}
                className={`notif-item${n.readAt ? "" : " unread"}`}
              >
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
