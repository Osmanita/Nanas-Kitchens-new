"use client";

/** Earnings — seller portal (front-end-spec IA "S6"; FR21). Payout is the order total
 * minus the 15% platform commission recorded at checkout. "Paid out" is completed orders;
 * "upcoming" is money committed but still cooking. Refunded/declined/cancelled never show. */
import Link from "next/link";
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

  useEffect(() => {
    ensureSession().then((s) => {
      setSession(s);
      if (!s) router.replace("/login?next=/seller/earnings");
    });
  }, [router]);

  useEffect(() => {
    if (session?.role !== "seller") return;
    apiFetch("/kitchens/mine").then(async (res) => setKitchenId(res.ok ? (await res.json()).id : null));
  }, [session]);

  useEffect(() => {
    if (!kitchenId) return;
    apiFetch(`/kitchens/${kitchenId}/earnings`).then(async (res) => {
      if (res.ok) setData(await res.json());
    });
  }, [kitchenId]);

  if (session === undefined || (session?.role === "seller" && kitchenId === undefined)) {
    return (
      <main style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px" }}>
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
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 26, color: "var(--brand-green)" }}>Earnings</h1>
      <p style={{ margin: "0 0 20px", color: "var(--brand-muted)" }}>
        Your payout is each order total minus the 15% platform commission.
      </p>

      {data === undefined ? (
        <div className="skeleton" style={{ height: 160 }} />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            <div className="card">
              <div style={{ fontSize: 13, color: "var(--brand-muted)" }}>Paid out</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: "var(--brand-green)" }}>
                {money(data.paid.netCents)}
              </div>
              <div style={{ fontSize: 13, color: "var(--brand-muted)" }}>
                {data.paid.orders} completed order{data.paid.orders === 1 ? "" : "s"}
              </div>
            </div>
            <div className="card">
              <div style={{ fontSize: 13, color: "var(--brand-muted)" }}>Upcoming</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: "var(--brand-orange-dark)" }}>
                {money(data.upcoming.netCents)}
              </div>
              <div style={{ fontSize: 13, color: "var(--brand-muted)" }}>
                {data.upcoming.orders} order{data.upcoming.orders === 1 ? "" : "s"} in progress
              </div>
            </div>
            <div className="card">
              <div style={{ fontSize: 13, color: "var(--brand-muted)" }}>Commission paid</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: "var(--brand-ink)" }}>
                {money(data.paid.commissionCents)}
              </div>
              <div style={{ fontSize: 13, color: "var(--brand-muted)" }}>
                on {money(data.paid.grossCents)} in sales
              </div>
            </div>
          </div>

          <section className="card" style={{ marginTop: 24 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 18, color: "var(--brand-green)" }}>Last 14 days</h2>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--brand-muted)" }}>
              Daily payout from completed orders.
            </p>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 140 }}>
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
                    style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
                  >
                    <div
                      style={{
                        width: "100%",
                        height: Math.max(2, h),
                        background: d.netCents > 0 ? "var(--brand-orange)" : "var(--brand-border)",
                        borderRadius: "4px 4px 0 0",
                      }}
                    />
                    <span style={{ fontSize: 10, color: "var(--brand-muted)" }}>{label}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card" style={{ marginTop: 24 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 18, color: "var(--brand-green)" }}>Recent payouts</h2>
            {data.recent.length === 0 ? (
              <p style={{ margin: 0, color: "var(--brand-muted)", fontSize: 14 }}>
                No completed orders yet — payouts show up here as you finish orders.
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
