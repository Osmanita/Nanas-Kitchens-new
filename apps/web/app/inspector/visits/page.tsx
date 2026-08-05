"use client";

/** Inspector Portal — Assigned Visits (Story 7.2 AC1, FR20). The street address appears
 * here and nowhere else on the web app besides confirmed pickup orders (NFR5 scoping). */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, ensureSession, Session } from "../../../lib/api";
import { CUISINE_ICONS } from "../../../lib/cuisines";

export interface Visit {
  id: string;
  kitchenId: string;
  kitchenName: string;
  cuisineTag: string;
  address: string;
  scheduledAt: string;
  status: "assigned" | "scored";
  scoreTotal: number | null;
  scoreSubmittedAt: string | null;
}

export default function InspectorVisitsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [visits, setVisits] = useState<Visit[] | undefined>(undefined);

  useEffect(() => {
    ensureSession().then((s) => {
      setSession(s);
      if (!s) router.replace("/login?next=/inspector/visits");
    });
  }, [router]);

  useEffect(() => {
    if (session?.role !== "inspector") return;
    apiFetch("/inspections/assigned").then(async (res) => {
      if (res.ok) setVisits(await res.json());
    });
  }, [session]);

  if (session === undefined) {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
        <div className="skeleton" style={{ height: 180 }} />
      </main>
    );
  }

  if (!session) return null; // redirecting to /login

  if (session.role !== "inspector") {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
        <div className="form-error" role="alert">
          This page is for inspectors. You are signed in as a {session.role}.
        </div>
        <Link href="/">‹ Back home</Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 26, color: "var(--brand-green)" }}>Assigned Visits</h1>
      <p style={{ margin: "0 0 20px", color: "var(--brand-muted)" }}>
        Kitchens waiting for your inspection. Addresses are visible only to you, only for
        your assignments.
      </p>

      {visits === undefined && <div className="skeleton" style={{ height: 140 }} />}

      {visits?.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <p style={{ fontSize: 36, margin: 0 }}>🗓</p>
          <p style={{ fontWeight: 600, margin: "8px 0 4px" }}>No visits assigned yet</p>
          <p style={{ color: "var(--brand-muted)", margin: 0 }}>
            New assignments from the platform team appear here.
          </p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {visits?.map((v) => (
          <div key={v.id} className="card" style={{ padding: "18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <strong style={{ fontSize: 16 }}>
                {CUISINE_ICONS[v.cuisineTag] ?? "🍽️"} {v.kitchenName}
              </strong>
              {v.status === "scored" ? (
                <span className="badge hygiene">🛡 Scored {v.scoreTotal}/100</span>
              ) : (
                <span className="badge portions">Assigned</span>
              )}
            </div>
            <p style={{ margin: "8px 0 4px", fontSize: 14 }}>📍 {v.address}</p>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--brand-muted)" }}>
              Scheduled {new Date(v.scheduledAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
              {v.scoreSubmittedAt &&
                ` · submitted ${new Date(v.scoreSubmittedAt).toLocaleDateString()}`}
            </p>
            {v.status === "assigned" && (
              <Link
                href={`/inspector/score/${v.id}`}
                className="btn-primary"
                style={{ width: "auto", textDecoration: "none", display: "inline-block" }}
              >
                Open scoring form
              </Link>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
