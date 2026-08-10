"use client";

/** Kitchen Profile & Photos — seller portal (Story 1.3, FR1/NFR5; front-end-spec IA "S3").
 * Edit name/cuisine/description, change the address (re-geocoded server-side, encrypted at
 * rest, never displayed back), and manage up to 10 gallery photos (upload ≤5 MB
 * jpeg/png/webp, remove, make cover). */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, getSession, Session } from "../../../lib/api";
import { CUISINES } from "../../../lib/cuisines";
import AddressAutocomplete, { AddressPick } from "../../components/AddressAutocomplete";

interface Kitchen {
  id: string;
  name: string;
  cuisineTag: string;
  description: string;
  photos: string[];
  complianceAttestedAt: string | null;
  hygieneScoreTotal: number | null;
  hygieneScoredAt: string | null;
}

interface HealthReport {
  id: string;
  fileUrl: string;
  filename: string;
  uploadedAt: string;
}

const MAX_PHOTOS = 10;

export default function SellerKitchenPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [kitchen, setKitchen] = useState<Kitchen | null | undefined>(undefined);

  // Edit form state, seeded from the kitchen once loaded.
  const [form, setForm] = useState({ name: "", cuisineTag: "turkish", description: "", address: "" });
  const [needManualGeo, setNeedManualGeo] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Set once the seller picks a real place; carries the coordinates so the API never geocodes. */
  const [picked, setPicked] = useState<AddressPick | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const s = getSession();
    setSession(s);
    if (!s) router.replace("/login?next=/seller/kitchen");
  }, [router]);

  const load = useCallback(async () => {
    const res = await apiFetch("/kitchens/mine");
    if (!res.ok) return setKitchen(null);
    const body: Kitchen = await res.json();
    setKitchen(body);
    setForm({ name: body.name, cuisineTag: body.cuisineTag, description: body.description, address: "" });
  }, []);

  useEffect(() => {
    if (session?.role === "seller") load();
  }, [session, load]);

  async function save() {
    if (!kitchen) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        cuisineTag: form.cuisineTag,
        description: form.description,
      };
      if (form.address.trim()) {
        payload.address = form.address.trim();
        if (picked && picked.label === form.address.trim()) {
          // Picked from the suggestion list — send its coordinates so the server skips geocoding.
          payload.lat = picked.lat;
          payload.lng = picked.lon;
        } else if (needManualGeo && lat && lng) {
          payload.lat = Number(lat);
          payload.lng = Number(lng);
        }
      }
      const res = await apiFetch(`/kitchens/${kitchen.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.message === "GEOCODING_FAILED") {
          // Story 1.3 AC4 — last-resort manual entry, now only reachable for a typed
          // address that was never confirmed against the suggestion list.
          setNeedManualGeo(true);
          setError("We couldn't locate that address. Pick one from the suggestions as you type — or enter coordinates below.");
        } else {
          setError("Could not save the profile — check the fields and try again.");
        }
        return;
      }
      setNeedManualGeo(false);
      setLat("");
      setLng("");
      setPicked(null);
      setNotice(form.address.trim() ? "Profile saved — new address geocoded and encrypted." : "Profile saved.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    if (!kitchen) return;
    setError(null);
    setNotice(null);
    if (file.size > 5 * 1024 * 1024) {
      setError("Photos must be 5 MB or smaller.");
      return;
    }
    const data = new FormData();
    data.append("file", file);
    setBusy(true);
    try {
      const res = await apiFetch(`/kitchens/${kitchen.id}/photos`, { method: "POST", body: data });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          body.message === "TOO_MANY_PHOTOS"
            ? `You can have at most ${MAX_PHOTOS} photos — remove one first.`
            : body.message === "UNSUPPORTED_PHOTO_TYPE"
              ? "Only JPEG, PNG or WebP photos are supported."
              : "Could not upload the photo.",
        );
        return;
      }
      setKitchen(await res.json());
      setNotice("Photo uploaded.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  /** photos is a full-replace list on PATCH — used for remove and make-cover. */
  async function setPhotos(photos: string[]) {
    if (!kitchen) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/kitchens/${kitchen.id}`, {
        method: "PATCH",
        body: JSON.stringify({ photos }),
      });
      if (res.ok) setKitchen(await res.json());
      else setError("Could not update the gallery.");
    } finally {
      setBusy(false);
    }
  }

  if (session === undefined || (session?.role === "seller" && kitchen === undefined)) {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
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

  if (kitchen === null) {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <p style={{ fontSize: 36, margin: 0 }}>🏠</p>
          <p style={{ fontWeight: 600, margin: "8px 0 4px" }}>No kitchen yet</p>
          <p style={{ color: "var(--brand-muted)", margin: "0 0 16px" }}>
            Create your kitchen first, then come back to polish the profile.
          </p>
          <Link href="/seller/menu" className="btn-primary" style={{ width: "auto", textDecoration: "none" }}>
            Set up my kitchen
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 26, color: "var(--brand-green)" }}>Kitchen Profile</h1>
      <p style={{ margin: "0 0 20px", color: "var(--brand-muted)" }}>
        What buyers see on <Link href={`/kitchens/${kitchen.id}`}>your public page</Link> — your street
        address is never shown there.
      </p>

      <section className="card">
        <h2 style={{ margin: "0 0 12px", fontSize: 20, color: "var(--brand-green)" }}>Details</h2>
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
        <label>
          Kitchen name
          <input
            className="field"
            required
            minLength={2}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </label>
        <label>
          Cuisine
          <select
            className="field"
            value={form.cuisineTag}
            onChange={(e) => setForm((f) => ({ ...f, cuisineTag: e.target.value }))}
          >
            {CUISINES.map((c) => (
              <option key={c.tag} value={c.tag}>
                {c.icon} {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Description
          <input
            className="field"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </label>
        <label htmlFor="kitchen-address">
          New address <span style={{ color: "var(--brand-muted)" }}>(optional — blank keeps the current one; encrypted, never public)</span>
        </label>
        <AddressAutocomplete
          id="kitchen-address"
          value={form.address}
          onChange={(v) => {
            setForm((f) => ({ ...f, address: v }));
            // Typing again invalidates the previous pick; the address must be re-confirmed.
            setPicked(null);
            setNeedManualGeo(false);
          }}
          onPick={(pick) => {
            setPicked(pick);
            setNeedManualGeo(false);
            setError(null);
          }}
        />
        {picked ? (
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--brand-green)" }}>
            {picked.approximate
              ? "✓ Placed at the nearest area we could find — your typed address is kept as-is."
              : "✓ Address confirmed on the map — no coordinates needed."}
          </p>
        ) : (
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--brand-muted)" }}>
            Pick your address from the list so we can place your kitchen on the map.
          </p>
        )}
        {needManualGeo && (
          <div style={{ display: "flex", gap: 12 }}>
            <label style={{ flex: 1 }}>
              Latitude
              <input className="field" value={lat} onChange={(e) => setLat(e.target.value)} />
            </label>
            <label style={{ flex: 1 }}>
              Longitude
              <input className="field" value={lng} onChange={(e) => setLng(e.target.value)} />
            </label>
          </div>
        )}
        <button className="btn-primary" style={{ width: "auto" }} disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save profile"}
        </button>
      </section>

      <section className="card" style={{ marginTop: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 20, color: "var(--brand-green)" }}>
            Photos <span style={{ fontSize: 14, color: "var(--brand-muted)" }}>({kitchen.photos.length}/{MAX_PHOTOS})</span>
          </h2>
          <button
            className="btn-add"
            disabled={busy || kitchen.photos.length >= MAX_PHOTOS}
            onClick={() => fileInput.current?.click()}
          >
            + Upload photo
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </div>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--brand-muted)" }}>
          JPEG, PNG or WebP, up to 5 MB. The first photo is your cover.
        </p>

        {kitchen.photos.length === 0 ? (
          <p style={{ margin: "16px 0 0", color: "var(--brand-muted)", fontSize: 14 }}>
            No photos yet — kitchens with photos get far more orders.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 12,
              marginTop: 16,
            }}
          >
            {kitchen.photos.map((url, i) => (
              <figure key={url} style={{ margin: 0, position: "relative" }}>
                <img
                  src={url}
                  alt={`Kitchen photo ${i + 1}`}
                  style={{ width: "100%", height: 110, objectFit: "cover", borderRadius: 10, display: "block" }}
                />
                {i === 0 && (
                  <span className="flag-tag" style={{ top: 6, left: 6, right: "auto" }}>
                    Cover
                  </span>
                )}
                <figcaption style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  {i !== 0 && (
                    <button
                      className="btn-add"
                      style={{ padding: "3px 10px", fontSize: 12 }}
                      disabled={busy}
                      onClick={() => setPhotos([url, ...kitchen.photos.filter((p) => p !== url)])}
                    >
                      Make cover
                    </button>
                  )}
                  <button
                    className="btn-add"
                    style={{ padding: "3px 10px", fontSize: 12 }}
                    aria-label={`Remove photo ${i + 1}`}
                    disabled={busy}
                    onClick={() => setPhotos(kitchen.photos.filter((p) => p !== url))}
                  >
                    Remove
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      <HealthReportsSection kitchenId={kitchen.id} />

      {kitchen.hygieneScoreTotal != null && (
        <ScoreDisputeSection
          kitchenId={kitchen.id}
          score={kitchen.hygieneScoreTotal}
          scoredAt={kitchen.hygieneScoredAt}
        />
      )}
    </main>
  );
}

/** Story 7.3 — a seller can dispute their hygiene badge; an admin dismisses or annuls it. */
function ScoreDisputeSection({
  kitchenId,
  score,
  scoredAt,
}: {
  kitchenId: string;
  score: number;
  scoredAt: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (reason.trim().length < 10) {
      setError("Explain the issue in at least a sentence (10+ characters).");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/kitchens/${kitchenId}/score-dispute`, {
      method: "POST",
      body: JSON.stringify({ reason: reason.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(
        body.message === "DISPUTE_ALREADY_OPEN"
          ? "You already have an open dispute — the platform team will review it."
          : "Could not submit the dispute — try again.",
      );
      return;
    }
    setSent(true);
  }

  return (
    <section className="card" style={{ marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: "var(--brand-green)" }}>Hygiene score</h2>
          <p style={{ margin: "4px 0 0", fontSize: 14 }}>
            <span className="badge hygiene">🛡 {score}/100</span>
            {scoredAt && (
              <span style={{ marginLeft: 8, fontSize: 13, color: "var(--brand-muted)" }}>
                inspected {new Date(scoredAt).toLocaleDateString()}
              </span>
            )}
          </p>
        </div>
        {!open && !sent && (
          <button className="btn-add" onClick={() => setOpen(true)}>
            Dispute this score
          </button>
        )}
      </div>

      {sent && (
        <div
          role="status"
          style={{
            marginTop: 12,
            background: "#e8f1e8",
            color: "var(--brand-green)",
            border: "1px solid #cfe0cf",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 14,
          }}
        >
          Dispute submitted — the platform team will review it and notify you.
        </div>
      )}

      {open && !sent && (
        <div style={{ marginTop: 12 }}>
          <textarea
            className="field"
            rows={3}
            maxLength={1000}
            placeholder="What was wrong with the inspection? Be specific."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn-primary" style={{ width: "auto" }} disabled={busy} onClick={submit}>
              {busy ? "Submitting…" : "Submit dispute"}
            </button>
            <button className="btn-add" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Story 7.1 (FR19) — health/permit documents (PDF or image); the list is public on the
 * kitchen profile with upload dates. */
function HealthReportsSection({ kitchenId }: { kitchenId: string }) {
  const [reports, setReports] = useState<HealthReport[] | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await apiFetch(`/kitchens/${kitchenId}/health-reports`);
    if (res.ok) setReports(await res.json());
  }, [kitchenId]);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(file: File) {
    setError(null);
    if (file.size > 5 * 1024 * 1024) {
      setError("Documents must be 5 MB or smaller.");
      return;
    }
    const data = new FormData();
    data.append("file", file);
    setBusy(true);
    try {
      const res = await apiFetch(`/kitchens/${kitchenId}/health-reports`, { method: "POST", body: data });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          body.message === "UNSUPPORTED_DOCUMENT_TYPE"
            ? "Only PDF, JPEG, PNG or WebP documents are supported."
            : "Could not upload the document.",
        );
        return;
      }
      setReports(await res.json());
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/kitchens/${kitchenId}/health-reports/${id}`, { method: "DELETE" });
      if (res.ok || res.status === 204) await load();
      else setError("Could not remove the document.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 20, color: "var(--brand-green)" }}>Health documents</h2>
        <button className="btn-add" disabled={busy} onClick={() => fileInput.current?.click()}>
          + Upload document
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
      </div>
      <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--brand-muted)" }}>
        Permits and health reports (PDF or image, ≤5 MB). Shown publicly on your profile with the
        upload date — recent documents build trust.
      </p>

      {error && (
        <div className="form-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      {reports?.length === 0 ? (
        <p style={{ margin: "16px 0 0", color: "var(--brand-muted)", fontSize: 14 }}>
          No documents yet.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
          {reports?.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                border: "1px solid var(--brand-border)",
                borderRadius: 10,
                padding: "10px 14px",
              }}
            >
              <span style={{ fontSize: 20 }}>📄</span>
              <a href={r.fileUrl} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0, fontSize: 14 }}>
                {r.filename}
              </a>
              <span style={{ fontSize: 12, color: "var(--brand-muted)" }}>
                {new Date(r.uploadedAt).toLocaleDateString()}
              </span>
              <button
                className="btn-add"
                style={{ padding: "3px 10px", fontSize: 12 }}
                aria-label={`Remove ${r.filename}`}
                disabled={busy}
                onClick={() => remove(r.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
