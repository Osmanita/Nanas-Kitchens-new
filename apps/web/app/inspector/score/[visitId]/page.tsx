"use client";

/** Inspector Scoring Form (Story 7.2 AC2/AC3, FR20; front-end-spec "Inspector Scoring
 * Form"). Five sub-scores (0–20 each) auto-sum to the 0–100 badge total, photo evidence
 * uploads ride along, and the draft persists locally per visit so a dropped connection
 * in the field never loses work — it's restored on reload and cleared on submit.
 * Submission is locked server-side (submit-once); edits need the admin dispute flow. */
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiFetch, ensureSession } from "../../../../lib/api";
import type { Visit } from "../../visits/page";

const SUB_SCORES: { key: string; label: string; hint: string }[] = [
  { key: "storage", label: "Storage", hint: "Cold chain, labeling, separation" },
  { key: "prepSurfaces", label: "Prep surfaces", hint: "Cleanliness, cross-contamination" },
  { key: "temperatureControl", label: "Temperature control", hint: "Cooking, holding, cooling" },
  { key: "personalHygiene", label: "Personal hygiene", hint: "Handwashing, gloves, health" },
  { key: "documentation", label: "Documentation", hint: "Permits, logs, traceability" },
];

const draftKey = (visitId: string) => `inspection-draft:${visitId}`;

export default function ScoringFormPage() {
  const { visitId } = useParams<{ visitId: string }>();
  const router = useRouter();
  const [visit, setVisit] = useState<Visit | null | undefined>(undefined);
  const [scores, setScores] = useState<Record<string, number>>(
    Object.fromEntries(SUB_SCORES.map((s) => [s.key, 10])),
  );
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ensureSession().then((s) => {
      if (!s) {
        router.replace(`/login?next=/inspector/score/${visitId}`);
        return;
      }
      if (s.role !== "inspector") {
        setVisit(null);
        return;
      }
      apiFetch("/inspections/assigned").then(async (res) => {
        if (!res.ok) return setVisit(null);
        const visits: Visit[] = await res.json();
        setVisit(visits.find((v) => v.id === visitId) ?? null);
      });
      // AC2 offline draft — restore any locally saved work for this visit.
      try {
        const saved = localStorage.getItem(draftKey(visitId));
        if (saved) {
          const draft = JSON.parse(saved);
          if (draft.scores) setScores(draft.scores);
          if (draft.photos) setPhotos(draft.photos);
          setDraftRestored(true);
        }
      } catch {
        /* corrupt draft — start fresh */
      }
    });
  }, [visitId, router]);

  // Persist the draft on every change (cheap, and survives crashes/offline).
  useEffect(() => {
    if (submitted !== null) return;
    localStorage.setItem(draftKey(visitId), JSON.stringify({ scores, photos }));
  }, [scores, photos, visitId, submitted]);

  const total = Object.values(scores).reduce((a, b) => a + b, 0);

  async function uploadEvidence(file: File) {
    setError(null);
    if (file.size > 5 * 1024 * 1024) {
      setError("Photos must be 5 MB or smaller.");
      return;
    }
    const data = new FormData();
    data.append("file", file);
    setBusy(true);
    try {
      const res = await apiFetch(`/inspections/${visitId}/evidence`, { method: "POST", body: data });
      if (!res.ok) {
        setError("Could not upload the photo.");
        return;
      }
      const body = await res.json();
      setPhotos((p) => [...p, body.url]);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/inspections/${visitId}/score`, {
        method: "POST",
        body: JSON.stringify({ subScores: scores, photos }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          body.message === "ALREADY_SCORED"
            ? "This visit is already scored — scores are locked after submission."
            : "Could not submit the score — check the values and try again.",
        );
        return;
      }
      localStorage.removeItem(draftKey(visitId)); // draft served its purpose
      setSubmitted(body.total);
    } finally {
      setBusy(false);
    }
  }

  if (visit === undefined) {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 24px" }}>
        <div className="skeleton" style={{ height: 220 }} />
      </main>
    );
  }

  if (visit === null) {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 24px" }}>
        <div className="form-error" role="alert">
          Visit not found — it may belong to another inspector.
        </div>
        <Link href="/inspector/visits">‹ Back to assigned visits</Link>
      </main>
    );
  }

  if (submitted !== null || visit.status === "scored") {
    const score = submitted ?? visit.scoreTotal;
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 24px" }}>
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <p style={{ fontSize: 40, margin: 0 }}>🛡</p>
          <h1 style={{ margin: "8px 0 4px", fontSize: 24, color: "var(--brand-green)" }}>
            {score}/100 submitted
          </h1>
          <p style={{ color: "var(--brand-muted)", margin: 0 }}>
            The badge on {visit.kitchenName} is live. Scores are locked — corrections go
            through the platform team.
          </p>
          <p style={{ marginTop: 16 }}>
            <Link href="/inspector/visits">‹ Back to assigned visits</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 24px" }}>
      <Link href="/inspector/visits" style={{ fontSize: 14 }}>
        ‹ Assigned visits
      </Link>
      <h1 style={{ margin: "12px 0 4px", fontSize: 24, color: "var(--brand-green)" }}>
        Score {visit.kitchenName}
      </h1>
      <p style={{ margin: "0 0 16px", color: "var(--brand-muted)", fontSize: 14 }}>
        📍 {visit.address} · scheduled{" "}
        {new Date(visit.scheduledAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
      </p>

      {draftRestored && (
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
          Draft restored — your earlier answers were saved on this device.
        </div>
      )}

      <section className="card">
        {SUB_SCORES.map(({ key, label, hint }) => (
          <div key={key} style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <label htmlFor={`score-${key}`} style={{ fontWeight: 600 }}>
                {label}
              </label>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                <strong>{scores[key]}</strong>
                <span style={{ color: "var(--brand-muted)" }}>/20</span>
              </span>
            </div>
            <p style={{ margin: "2px 0 6px", fontSize: 12, color: "var(--brand-muted)" }}>{hint}</p>
            <input
              id={`score-${key}`}
              type="range"
              min={0}
              max={20}
              step={1}
              value={scores[key]}
              onChange={(e) => setScores((s) => ({ ...s, [key]: Number(e.target.value) }))}
              style={{ width: "100%", accentColor: "var(--brand-orange)" }}
            />
          </div>
        ))}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid var(--brand-border)",
            paddingTop: 14,
          }}
        >
          <strong style={{ fontSize: 16 }}>Total</strong>
          <strong style={{ fontSize: 22, color: "var(--brand-green)" }} aria-live="polite">
            {total}/100
          </strong>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>Photo evidence ({photos.length})</strong>
          <button className="btn-add" disabled={busy} onClick={() => fileInput.current?.click()}>
            + Add photo
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && uploadEvidence(e.target.files[0])}
          />
        </div>
        {photos.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {photos.map((url) => (
              <div key={url} style={{ position: "relative" }}>
                <img
                  src={url}
                  alt="Evidence"
                  style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 10, display: "block" }}
                />
                <button
                  aria-label="Remove evidence photo"
                  onClick={() => setPhotos((p) => p.filter((u) => u !== url))}
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    border: "1px solid var(--brand-border)",
                    background: "#fff",
                    cursor: "pointer",
                    fontSize: 11,
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {error && (
        <div className="form-error" role="alert" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}

      <button className="btn-primary" style={{ marginTop: 16 }} disabled={busy} onClick={submit}>
        {busy ? "Submitting…" : `Submit final score — ${total}/100`}
      </button>
      <p style={{ marginTop: 8, fontSize: 12, color: "var(--brand-muted)", textAlign: "center" }}>
        Submitting locks the score. Your draft is saved on this device until then.
      </p>
    </main>
  );
}
