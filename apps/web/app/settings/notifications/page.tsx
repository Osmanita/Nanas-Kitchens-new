"use client";

/** Notification settings (Story 4.4 follow-up, FR22). Toggle the external "buzz me"
 * channels per category; the in-app bell always shows every notification regardless. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, ensureSession, Session } from "../../../lib/api";
import PhoneSettingsCard from "../../components/PhoneSettingsCard";

interface Grid {
  channels: string[]; // ["email", "push"]
  categories: { category: string; channels: Record<string, boolean> }[];
}

const CATEGORY_LABELS: Record<string, { title: string; hint: string }> = {
  orders: { title: "Orders & payments", hint: "New orders, status changes, refunds" },
  community: { title: "Community", hint: "Reviews, dish requests" },
  trust: { title: "Trust & inspections", hint: "Hygiene score disputes" },
};
const CHANNEL_LABELS: Record<string, string> = { email: "Email", push: "Push" };

export default function NotificationSettingsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [grid, setGrid] = useState<Grid | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    ensureSession().then((s) => {
      setSession(s);
      if (!s) router.replace("/login?next=/settings/notifications");
    });
  }, [router]);

  useEffect(() => {
    if (!session) return;
    apiFetch("/notifications/preferences").then(async (res) => {
      if (res.ok) setGrid(await res.json());
    });
  }, [session]);

  function toggle(category: string, channel: string) {
    setGrid((g) =>
      g
        ? {
            ...g,
            categories: g.categories.map((c) =>
              c.category === category
                ? { ...c, channels: { ...c.channels, [channel]: !c.channels[channel] } }
                : c,
            ),
          }
        : g,
    );
    setNotice(null);
  }

  async function save() {
    if (!grid) return;
    setSaving(true);
    setNotice(null);
    // The API stores the OFF keys ("category:channel"); everything else stays on.
    const disabled = grid.categories.flatMap((c) =>
      Object.entries(c.channels)
        .filter(([, on]) => !on)
        .map(([ch]) => `${c.category}:${ch}`),
    );
    try {
      const res = await apiFetch("/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify({ disabled }),
      });
      if (res.ok) {
        setGrid(await res.json());
        setNotice("Preferences saved.");
      } else {
        setNotice("Could not save — try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (session === undefined || (session && grid === undefined)) {
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "32px 24px" }}>
        <div className="skeleton" style={{ height: 200 }} />
      </main>
    );
  }

  if (!session) return null; // redirecting

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 26, color: "var(--brand-green)" }}>Notifications</h1>
      <p style={{ margin: "0 0 20px", color: "var(--brand-muted)" }}>
        Choose how we reach you. The in-app bell always shows everything — these control
        email and push.
      </p>

      <section className="card">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto auto",
            gap: "0 20px",
            alignItems: "center",
          }}
        >
          <span />
          {grid!.channels.map((ch) => (
            <span key={ch} style={{ fontSize: 13, fontWeight: 600, textAlign: "center", color: "var(--brand-muted)" }}>
              {CHANNEL_LABELS[ch] ?? ch}
            </span>
          ))}

          {grid!.categories.map((c) => (
            <div key={c.category} style={{ display: "contents" }}>
              <div style={{ padding: "14px 0", borderTop: "1px solid var(--brand-border)" }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{CATEGORY_LABELS[c.category]?.title ?? c.category}</div>
                <div style={{ fontSize: 12, color: "var(--brand-muted)" }}>{CATEGORY_LABELS[c.category]?.hint}</div>
              </div>
              {grid!.channels.map((ch) => (
                <label
                  key={ch}
                  style={{
                    padding: "14px 0",
                    borderTop: "1px solid var(--brand-border)",
                    display: "flex",
                    justifyContent: "center",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={c.channels[ch] ?? false}
                    onChange={() => toggle(c.category, ch)}
                    aria-label={`${CATEGORY_LABELS[c.category]?.title ?? c.category} — ${CHANNEL_LABELS[ch] ?? ch}`}
                    style={{ width: 20, height: 20, accentColor: "var(--brand-orange)", cursor: "pointer" }}
                  />
                </label>
              ))}
            </div>
          ))}
        </div>

        {notice && (
          <div
            role="status"
            style={{
              marginTop: 16,
              background: "#e8f1e8",
              color: "var(--brand-green)",
              border: "1px solid #cfe0cf",
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 14,
            }}
          >
            {notice}
          </div>
        )}

        <button className="btn-primary" style={{ marginTop: 16 }} disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save preferences"}
        </button>
      </section>

      <PhoneSettingsCard />

      <p style={{ marginTop: 16 }}>
        <Link href="/">‹ Back home</Link>
      </p>
    </main>
  );
}
