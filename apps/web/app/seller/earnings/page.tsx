"use client";

/** Earnings — seller portal (front-end-spec IA "S6"; FR21). Payout is the order total
 * minus the 15% platform commission recorded at checkout. "Paid out" is completed orders;
 * "upcoming" is money committed but still cooking. Refunded/declined/cancelled never show. */
import Link from "next/link";
import { PageIntro } from "../../components/PageKit";
import styles from "../../marketplace.module.css";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, ensureSession, Session } from "../../../lib/api";
import { money } from "../../../lib/cart";

interface Bucket {
  orders: number;
  grossCents: number;
  commissionCents: number;
  netCents: number;
}

interface Txn {
  id: string;
  grossCents: number;
  commissionCents: number;
  netCents: number;
  fulfillment: string;
  itemsSummary: string | null;
  createdAt: string;
}

interface Earnings {
  paid: Bucket;
  upcoming: Bucket;
  daily: { day: string; netCents: number }[];
  recent: Txn[];
}

export default function SellerEarningsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [kitchenId, setKitchenId] = useState<string | null | undefined>(undefined);
  const [data, setData] = useState<Earnings | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    ensureSession().then((s) => {
      setSession(s);
      if (!s) router.replace("/login?next=/seller/earnings");
    });
  }, [router]);

  useEffect(() => {
    if (session?.role !== "seller") return;
    setLoadError(false);
    apiFetch("/kitchens/mine").then(async (res) => {
      if (res.status === 404) return setKitchenId(null);
      if (!res.ok) throw new Error("Could not load kitchen");
      setKitchenId((await res.json()).id);
    }).catch(() => setLoadError(true));
  }, [session, retry]);

  useEffect(() => {
    if (!kitchenId) return;
    apiFetch(`/kitchens/${kitchenId}/earnings`).then(async (res) => {
      if (!res.ok) throw new Error("Could not load earnings");
      setData(await res.json());
    }).catch(() => setLoadError(true));
  }, [kitchenId, retry]);

  if (loadError) return <main className={`${styles.page} ${styles.compact}`}>
    <PageIntro eyebrow="Your kitchen / Earnings" title="Earnings" />
    <div className="form-error" role="alert">We couldn’t load your earnings. <button onClick={() => { setLoadError(false); setRetry((n) => n + 1); }}>Try again</button></div>
  </main>;

  if (session === undefined || (session?.role === "seller" && kitchenId === undefined)) {
    return (
      <main className={`${styles.page} ${styles.portal} ${styles.compact}`}>
        <div className="skeleton" style={{ height: 220 }} />
      </main>
    );
  }

  if (!session) return null; // redirecting to /login

  if (session.role !== "seller") {
    return (
      <main className={`${styles.page} ${styles.portal} ${styles.compact}`}>
        <div className="form-error" role="alert">
          This page is for sellers. You are signed in as a {session.role}.
        </div>
        <Link href="/">‹ Back home</Link>
      </main>
    );
  }

  if (kitchenId === null) {
    return (
      <main className={`${styles.page} ${styles.portal} ${styles.compact}`}>
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <p style={{ fontSize: 36, margin: 0 }}>💰</p>
          <p style={{ fontWeight: 600, margin: "8px 0 4px" }}>No earnings yet</p>
          <p style={{ color: "var(--brand-muted)", margin: "0 0 16px" }}>
            Set up your kitchen and complete orders to start earning.
          </p>
          <Link href="/seller/menu" className="btn-primary" style={{ width: "auto", textDecoration: "none" }}>
            Set up my kitchen
          </Link>
        </div>
      </main>
    );
  }

  const maxDaily = Math.max(1, ...(data?.daily ?? []).map((d) => d.netCents));

  return (
    <main className={`${styles.page} ${styles.portal} ${styles.compact}`}>
      <PageIntro eyebrow="Your kitchen / Earnings" title="Made with care. Earned by you." description="Your food sales after the 15% platform commission. Delivery fees and courier tips are excluded." />

      {data === undefined ? (
        <div className="skeleton" style={{ height: 160 }} />
      ) : (
        <>
          <div className={styles.metrics}>
            <div className={styles.metric}><span>Completed sales · net</span><strong>{money(data.paid.netCents)}</strong><small>{data.paid.orders} completed orders</small></div>
            <div className={styles.metric}><span>In progress · net</span><strong>{money(data.upcoming.netCents)}</strong><small>{data.upcoming.orders} orders in the kitchen</small></div>
            <div className={styles.metric}><span>Platform commission</span><strong>{money(data.paid.commissionCents)}</strong><small>On {money(data.paid.grossCents)} in completed sales</small></div>
          </div>

          <section className="card" style={{ marginTop: 24 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 18, color: "var(--brand-green)" }}>Last 14 days</h2>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--brand-muted)" }}>
              Net earnings from completed orders.
            </p>
            {data.daily.every((d) => d.netCents === 0) ? <p className={styles.note}>Your first completed sale will start this chart.</p> : <div className={styles.chart} tabIndex={0} role="region" aria-label="Daily net earnings chart">
              {data.daily.map((d) => {
                const h = Math.round((d.netCents / maxDaily) * 120);
                const label = new Date(d.day + "T00:00:00").toLocaleDateString([], {
                  month: "numeric",
                  day: "numeric",
                });
                return (
                  <div
                    key={d.day}
                    title={`${label}: ${money(d.netCents)}`}
                    className={styles.chartBar}
                  >
                    <div
                      style={{
                        width: "100%",
                        height: Math.max(2, h),
                        background: d.netCents > 0 ? "var(--brand-green)" : "var(--brand-border)",
                        borderRadius: "4px 4px 0 0",
                      }}
                    />
                    <span style={{ fontSize: 10, color: "var(--brand-muted)" }}>{label}</span>
                  </div>
                );
              })}
            </div>}
          </section>

          <section className="card" style={{ marginTop: 24 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 18, color: "var(--brand-green)" }}>Completed orders</h2>
            {data.recent.length === 0 ? (
              <p style={{ margin: 0, color: "var(--brand-muted)", fontSize: 14 }}>
                No completed orders yet — earnings show up here as you finish orders.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.recent.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      borderBottom: "1px solid var(--brand-border)",
                      paddingBottom: 8,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{t.itemsSummary ?? "Order"}</div>
                      <div style={{ fontSize: 12, color: "var(--brand-muted)" }}>
                        {t.fulfillment === "delivery" ? "🚗 Delivery" : "🛍 Pickup"} ·{" "}
                        {new Date(t.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700, color: "var(--brand-green)" }}>+{money(t.netCents)}</div>
                      <div style={{ fontSize: 11, color: "var(--brand-muted)" }}>
                        {money(t.grossCents)} − {money(t.commissionCents)} fee
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
