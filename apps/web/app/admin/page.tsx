"use client";

/** Admin console (Story 7.3): inspector provisioning, visit assignment + overview, and
 * the score-dispute queue promised by Story 7.2 AC3. Platform staff only. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ensureSession, Session } from "../../lib/api";

interface Inspector {
  id: string;
  email: string;
  assigned: number;
  scored: number;
}

interface Visit {
  id: string;
  kitchenName: string;
  inspectorEmail: string;
  scheduledAt: string;
  status: "assigned" | "scored";
  scoreTotal: number | null;
}

interface KitchenOption {
  id: string;
  name: string;
}

interface Dispute {
  id: string;
  kitchenName: string;
  currentScore: number | null;
  reason: string;
  status: "open" | "dismissed" | "annulled";
  adminNote: string | null;
  createdAt: string;
}

export default function AdminPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [inspectors, setInspectors] = useState<Inspector[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [kitchens, setKitchens] = useState<KitchenOption[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    ensureSession().then((s) => {
      setSession(s);
      if (!s) router.replace("/login?next=/admin");
    });
  }, [router]);

  const loadAll = useCallback(async () => {
    const [i, v, k, d] = await Promise.all([
      apiFetch("/admin/inspectors"),
      apiFetch("/admin/inspections"),
      apiFetch("/admin/kitchens"),
      apiFetch("/admin/disputes"),
    ]);
    if (i.ok) setInspectors(await i.json());
    if (v.ok) setVisits(await v.json());
    if (k.ok) setKitchens(await k.json());
    if (d.ok) setDisputes(await d.json());
  }, []);

  useEffect(() => {
    if (session?.role === "admin") loadAll();
  }, [session, loadAll]);

  if (session === undefined) {
    return (
      <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
        <div className="skeleton" style={{ height: 220 }} />
      </main>
    );
  }

  if (!session) return null; // redirecting to /login

  if (session.role !== "admin") {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
        <div className="form-error" role="alert">
          This page is for platform admins. You are signed in as a {session.role}.
        </div>
        <Link href="/">‹ Back home</Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 26, color: "var(--brand-green)" }}>Admin</h1>
      <p style={{ margin: "0 0 20px", color: "var(--brand-muted)" }}>
        Inspectors, visit assignments, and hygiene-score disputes.
      </p>

      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          style={{
            background: "#e8f1e8",
            color: "var(--brand-green)",
            border: "1px solid #cfe0cf",
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          {notice}
        </div>
      )}

      <DisputesQueue
        disputes={disputes}
        onResolved={(msg) => {
          setNotice(msg);
          setError(null);
          loadAll();
        }}
        onError={(msg) => setError(msg)}
      />

      <InspectorsSection
        inspectors={inspectors}
        onInvited={() => {
          setNotice("Inspector invited.");
          setError(null);
          loadAll();
        }}
        onError={(msg) => setError(msg)}
      />

      <AssignVisitSection
        kitchens={kitchens}
        inspectors={inspectors}
        onAssigned={() => {
          setNotice("Visit assigned.");
          setError(null);
          loadAll();
        }}
        onError={(msg) => setError(msg)}
      />

      <section className="card" style={{ marginTop: 24 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 20, color: "var(--brand-green)" }}>All visits</h2>
        {visits.length === 0 ? (
          <p style={{ margin: 0, color: "var(--brand-muted)", fontSize: 14 }}>No visits yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visits.map((v) => (
              <div
                key={v.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  border: "1px solid var(--brand-border)",
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontSize: 14,
                }}
              >
                <strong style={{ flex: 1, minWidth: 0 }}>{v.kitchenName}</strong>
                <span style={{ color: "var(--brand-muted)" }}>{v.inspectorEmail}</span>
                <span style={{ color: "var(--brand-muted)" }}>
                  {new Date(v.scheduledAt).toLocaleDateString()}
                </span>
                {v.status === "scored" ? (
                  <span className="badge hygiene">🛡 {v.scoreTotal}/100</span>
                ) : (
                  <span className="badge portions">assigned</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

/** Story 7.2 AC3 — the admin-mediated dispute resolution. */
function DisputesQueue({
  disputes,
  onResolved,
  onError,
}: {
  disputes: Dispute[];
  onResolved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const open = disputes.filter((d) => d.status === "open");
  const resolved = disputes.filter((d) => d.status !== "open");

  async function resolve(id: string, resolution: "dismissed" | "annulled") {
    setBusyId(id);
    try {
      const res = await apiFetch(`/admin/disputes/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ resolution, note: notes[id]?.trim() || undefined }),
      });
      if (!res.ok) {
        onError("Could not resolve the dispute.");
        return;
      }
      onResolved(
        resolution === "annulled"
          ? "Badge annulled — the kitchen shows “Not yet inspected” until re-inspection."
          : "Dispute dismissed — the score stands.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card">
      <h2 style={{ margin: 0, fontSize: 20, color: "var(--brand-green)" }}>
        Score disputes
        {open.length > 0 && (
          <span className="badge portions" style={{ marginLeft: 8 }}>
            {open.length} open
          </span>
        )}
      </h2>

      {open.length === 0 && (
        <p style={{ margin: "12px 0 0", color: "var(--brand-muted)", fontSize: 14 }}>
          No open disputes.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
        {open.map((d) => (
          <div key={d.id} style={{ border: "1px solid var(--brand-border)", borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <strong>{d.kitchenName}</strong>
              <span className="badge hygiene">current 🛡 {d.currentScore ?? "—"}</span>
            </div>
            <p style={{ margin: "8px 0", fontSize: 14 }}>“{d.reason}”</p>
            <input
              className="field"
              style={{ margin: "0 0 10px" }}
              placeholder="Resolution note (optional, sent to the seller)"
              value={notes[d.id] ?? ""}
              onChange={(e) => setNotes((n) => ({ ...n, [d.id]: e.target.value }))}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-accept" disabled={busyId === d.id} onClick={() => resolve(d.id, "dismissed")}>
                Dismiss — score stands
              </button>
              <button className="btn-decline" disabled={busyId === d.id} onClick={() => resolve(d.id, "annulled")}>
                Annul badge
              </button>
            </div>
          </div>
        ))}
      </div>

      {resolved.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: "pointer", color: "var(--brand-muted)", fontSize: 14 }}>
            Resolved ({resolved.length})
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            {resolved.map((d) => (
              <div
                key={d.id}
                style={{ border: "1px solid var(--brand-border)", borderRadius: 10, padding: "10px 14px", opacity: 0.8, fontSize: 14 }}
              >
                <span className={`badge ${d.status === "dismissed" ? "hygiene" : "soldout"}`} style={{ marginRight: 8 }}>
                  {d.status}
                </span>
                <strong>{d.kitchenName}</strong> — “{d.reason}”
                {d.adminNote && <em style={{ color: "var(--brand-muted)" }}> · {d.adminNote}</em>}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function InspectorsSection({
  inspectors,
  onInvited,
  onError,
}: {
  inspectors: Inspector[];
  onInvited: () => void;
  onError: (msg: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch("/admin/inspectors", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        onError(
          body.message === "EMAIL_TAKEN"
            ? "That email already has an account."
            : "Could not invite the inspector (password must be 8+ characters).",
        );
        return;
      }
      setEmail("");
      setPassword("");
      onInvited();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ marginTop: 24 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 20, color: "var(--brand-green)" }}>Inspectors</h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--brand-muted)" }}>
        Platform-invited only — there is no open inspector signup.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {inspectors.map((i) => (
          <div
            key={i.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              border: "1px solid var(--brand-border)",
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 14,
            }}
          >
            <strong style={{ flex: 1 }}>{i.email}</strong>
            <span className="badge portions">{i.assigned} assigned</span>
            <span className="badge hygiene">{i.scored} scored</span>
          </div>
        ))}
      </div>
      <form onSubmit={invite} style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <input
          className="field"
          style={{ flex: 2, minWidth: 200, margin: 0 }}
          type="email"
          required
          placeholder="inspector@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="field"
          style={{ flex: 1, minWidth: 140, margin: 0 }}
          type="password"
          required
          minLength={8}
          placeholder="Temp password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="btn-primary" style={{ width: "auto" }} disabled={busy}>
          {busy ? "Inviting…" : "Invite"}
        </button>
      </form>
    </section>
  );
}

function AssignVisitSection({
  kitchens,
  inspectors,
  onAssigned,
  onError,
}: {
  kitchens: KitchenOption[];
  inspectors: Inspector[];
  onAssigned: () => void;
  onError: (msg: string) => void;
}) {
  const [kitchenId, setKitchenId] = useState("");
  const [inspectorEmail, setInspectorEmail] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch("/inspections", {
        method: "POST",
        body: JSON.stringify({ kitchenId, inspectorEmail, scheduledAt }),
      });
      if (!res.ok) {
        onError("Could not assign the visit — check the fields.");
        return;
      }
      setScheduledAt("");
      onAssigned();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ marginTop: 24 }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 20, color: "var(--brand-green)" }}>Assign a visit</h2>
      <form onSubmit={assign} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select
          className="field"
          style={{ flex: 2, minWidth: 180, margin: 0 }}
          required
          value={kitchenId}
          onChange={(e) => setKitchenId(e.target.value)}
          aria-label="Kitchen"
        >
          <option value="">Kitchen…</option>
          {kitchens.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
        <select
          className="field"
          style={{ flex: 2, minWidth: 180, margin: 0 }}
          required
          value={inspectorEmail}
          onChange={(e) => setInspectorEmail(e.target.value)}
          aria-label="Inspector"
        >
          <option value="">Inspector…</option>
          {inspectors.map((i) => (
            <option key={i.id} value={i.email}>
              {i.email}
            </option>
          ))}
        </select>
        <input
          className="field"
          style={{ flex: 1, minWidth: 190, margin: 0 }}
          type="datetime-local"
          required
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          aria-label="Scheduled at"
        />
        <button className="btn-primary" style={{ width: "auto" }} disabled={busy}>
          {busy ? "Assigning…" : "Assign"}
        </button>
      </form>
    </section>
  );
}
