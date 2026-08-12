"use client";

/** Contact phone editor (User.phone) — shared by the seller kitchen profile and the
 * buyer/general account settings page. Loads and saves via /auth/me, independent of any
 * kitchen data. */
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

export default function PhoneSettingsCard() {
  const [phone, setPhone] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/auth/me").then(async (res) => {
      if (res.ok) setPhone((await res.json()).phone ?? "");
      setLoaded(true);
    });
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch("/auth/me", { method: "PATCH", body: JSON.stringify({ phone }) });
      if (!res.ok) {
        setError("Could not save the phone number — check the format and try again.");
        return;
      }
      setPhone((await res.json()).phone ?? "");
      setNotice("Phone number saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ marginTop: 24 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 20, color: "var(--brand-green)" }}>Contact phone</h2>
      <p style={{ margin: "0 0 12px", color: "var(--brand-muted)", fontSize: 13 }}>
        For order and delivery coordination — kept private, never shown publicly.
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
      <label>
        Phone number
        <input
          className="field"
          type="tel"
          placeholder="+1 555 123 4567"
          disabled={!loaded}
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setNotice(null);
          }}
        />
      </label>
      <button className="btn-primary" style={{ width: "auto" }} disabled={busy || !loaded} onClick={save}>
        {busy ? "Saving…" : "Save phone"}
      </button>
    </section>
  );
}
