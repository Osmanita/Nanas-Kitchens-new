"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, ensureSession, Session } from "../../lib/api";
import { money } from "../../lib/cart";
import { isWithinReviewWindow } from "../../lib/reviewWindow";
import Icon from "../components/Icon";
import { EmptyState, OrderStatus, PageIntro } from "../components/PageKit";
import styles from "../marketplace.module.css";

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
const ACTIVE = new Set([
  "pending",
  "confirmed",
  "accepted",
  "preparing",
  "ready",
]);

export default function OrdersPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [orders, setOrders] = useState<OrderRow[] | null | undefined>(
    undefined,
  );
  const [filter, setFilter] = useState<"all" | "active" | "past">("all");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    ensureSession().then((s) => {
      setSession(s);
      if (!s) router.replace("/login?next=/orders");
    });
  }, [router]);
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setOrders(undefined);
    apiFetch("/orders")
      .then(async (res) => {
        const rows = res.ok ? await res.json() : null;
        if (!cancelled) setOrders(rows);
      })
      .catch(() => {
        if (!cancelled) setOrders(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session, retry]);
  const active = orders?.filter((o) => ACTIVE.has(o.status)) ?? [];
  const past = orders?.filter((o) => !ACTIVE.has(o.status)) ?? [];
  const visible =
    filter === "active"
      ? active
      : filter === "past"
        ? past
        : [...active, ...past];
  if (session === null) return null;
  return (
    <main className={`${styles.page} ${styles.compact}`}>
      <PageIntro
        eyebrow="Your table"
        title="A little order history."
        description="Follow what’s cooking, revisit a favorite, or leave a little thanks."
      >
        <Link href="/" className={styles.secondary}>
          Find your next meal <Icon name="arrow" width={17} />
        </Link>
      </PageIntro>
      {orders === undefined ? (
        <div
          className={styles.stack}
          aria-label="Loading orders"
          aria-busy="true"
        >
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : orders === null ? (
        <div className="form-error" role="alert">
          We couldn’t load your orders.{" "}
          <button onClick={() => setRetry((n) => n + 1)}>Try again</button>
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          title="Your first meal is waiting"
          action={
            <Link href="/" className={styles.button}>
              Explore nearby kitchens <Icon name="arrow" width={17} />
            </Link>
          }
        >
          Once you order, you’ll find your meals and their progress right here.
        </EmptyState>
      ) : (
        <>
          <div className={styles.tabs} role="group" aria-label="Filter orders">
            {(
              [
                { id: "all", label: "All orders", count: orders.length },
                { id: "active", label: "In progress", count: active.length },
                { id: "past", label: "Past orders", count: past.length },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                aria-pressed={filter === tab.id}
                onClick={() => setFilter(tab.id)}
              >
                {tab.label}
                <span>{tab.count}</span>
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <EmptyState
              title={
                filter === "active"
                  ? "Nothing cooking just yet"
                  : "No past orders yet"
              }
            >
              Your orders will appear here as they move through the kitchen.
            </EmptyState>
          ) : (
            <div className={styles.orderList}>
              {visible.map((o) => (
                <OrderCard key={o.id} order={o} />
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}

function OrderCard({ order }: { order: OrderRow }) {
  const needsReview =
    order.status === "completed" &&
    !order.reviewed &&
    isWithinReviewWindow(order.createdAt);
  return (
    <article className={styles.orderRow}>
      <div className={styles.orderMark}>
        <Icon name="bowl" width={24} height={24} />
      </div>
      <div>
        <Link className={styles.orderName} href={`/orders/${order.id}`}>
          {order.kitchenName}
        </Link>
        {order.itemsSummary && (
          <div className={styles.muted}>{order.itemsSummary}</div>
        )}
        <div className={styles.orderMeta}>
          <OrderStatus status={order.status} />
          <small>
            {order.fulfillment === "delivery" ? "Delivery" : "Pickup"} ·{" "}
            {new Date(order.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </small>
          {needsReview && (
            <Link href={`/orders/${order.id}`} className={styles.textLink}>
              Rate your meal
            </Link>
          )}
          {order.deliveryTrackingUrl && ACTIVE.has(order.status) && (
            <a
              href={order.deliveryTrackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.textLink}
            >
              Track courier
            </a>
          )}
        </div>
      </div>
      <div className={styles.orderPrice}>
        <strong>{money(order.totalCents)}</strong>
        <Link href={`/orders/${order.id}`} className={styles.textLink}>
          View order <Icon name="arrow" width={16} height={16} />
        </Link>
      </div>
    </article>
  );
}
