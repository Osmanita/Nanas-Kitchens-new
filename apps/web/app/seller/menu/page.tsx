"use client";

/** Menus & Portions — seller portal (front-end-spec.md, FR3/FR4/FR6; Stories 2.1/2.2/2.3).
 * Single screen: dish library + daily menu builder (pick dishes → set portions → set
 * ready windows → publish). Drafts are edited via PATCH /kitchens/{id}/menu-days/{id};
 * published menus are immutable except live portion corrections (inventory adjust).
 * Onboarding (create kitchen, FR1) and compliance attestation (FR2) happen inline
 * because un-attested kitchens cannot publish. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ensureSession, Session } from "../../../lib/api";
import { CUISINES } from "../../../lib/cuisines";
import { money } from "../../../lib/cart";

interface Kitchen {
  id: string;
  name: string;
  cuisineTag: string;
  description: string;
  complianceAttestedAt: string | null;
}

interface Dish {
  id: string;
  name: string;
  description: string;
  photo: string | null;
  priceCents: number;
  dietaryTags: string[];
}

interface ReadyWindow {
  start: string;
  end: string;
  slotMinutes: number;
}

interface MenuDay {
  id: string;
  date: string;
  status: "draft" | "published";
  readyWindows: ReadyWindow[];
  items: { id: string; dishId: string; portionsTotal: number; portionsRemaining: number; dish: Dish }[];
}

const DIETARY_TAGS = ["vegetarian", "vegan", "gluten-free", "halal", "kosher", "dairy-free", "nut-free", "spicy"];
const DEFAULT_WINDOW: ReadyWindow = { start: "17:00", end: "20:00", slotMinutes: 30 };

const todayStr = () => new Date().toISOString().slice(0, 10);

/** API error codes (body.message) → seller-friendly copy. */
function explain(code: string | undefined): string {
  if (!code) return "Something went wrong — please try again.";
  if (code.startsWith("WINDOW_INVALID")) return "A ready window ends before it starts.";
  if (code.startsWith("DISH_NOT_IN_KITCHEN") || code.startsWith("DUPLICATE_DISH")) {
    return "The dish list is out of date — reload and try again.";
  }
  const map: Record<string, string> = {
    WINDOWS_OVERLAP: "Ready windows overlap — adjust the times.",
    READY_WINDOWS_REQUIRED: "Add at least one ready-time window.",
    MENU_DAY_EMPTY: "Add at least one dish with portions before publishing.",
    MENU_DAY_NOT_DRAFT: "This menu is already published and can no longer be edited.",
    MENU_DAY_EXISTS: "A menu for this date already exists — reloading it.",
    PUBLISH_REQUIRES_ATTESTATION: "You must attest to cottage-food compliance before publishing.",
    DISH_IN_USE: "This dish is on a menu and can't be deleted.",
    PORTIONS_CONFLICT: "Can't go below the portions already ordered.",
  };
  return map[code] ?? "Something went wrong — please try again.";
}

async function errorCode(res: Response): Promise<string | undefined> {
  const body = await res.json().catch(() => ({}));
  return typeof body.message === "string" ? body.message : undefined;
}

export default function SellerMenuPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [kitchen, setKitchen] = useState<Kitchen | null | undefined>(undefined);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [date, setDate] = useState(todayStr());
  const [menuDay, setMenuDay] = useState<MenuDay | null | undefined>(undefined);

  // Builder state for draft/new menus, saved via POST/PATCH menu-days.
  const [portions, setPortions] = useState<Record<string, number>>({}); // dishId -> portionsTotal
  const [windows, setWindows] = useState<ReadyWindow[]>([DEFAULT_WINDOW]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    ensureSession().then((s) => {
      setSession(s);
      if (!s) router.replace("/login?next=/seller/menu");
    });
  }, [router]);

  const loadKitchen = useCallback(async () => {
    const res = await apiFetch("/kitchens/mine");
    setKitchen(res.ok ? await res.json() : null);
  }, []);

  const loadDishes = useCallback(async (kitchenId: string) => {
    const res = await apiFetch(`/kitchens/${kitchenId}/dishes`);
    if (res.ok) setDishes(await res.json());
  }, []);

  const loadMenu = useCallback(async (kitchenId: string, d: string) => {
    setMenuDay(undefined);
    const res = await apiFetch(`/kitchens/${kitchenId}/menu-days?date=${d}`);
    const days: MenuDay[] = res.ok ? await res.json() : [];
    const day = days[0] ?? null;
    setMenuDay(day);
    setPortions(day ? Object.fromEntries(day.items.map((i) => [i.dishId, i.portionsTotal])) : {});
    setWindows(day?.readyWindows?.length ? day.readyWindows : [DEFAULT_WINDOW]);
    setDirty(false);
    setError(null);
    setNotice(null);
  }, []);

  useEffect(() => {
    if (session?.role === "seller") loadKitchen();
  }, [session, loadKitchen]);

  useEffect(() => {
    if (!kitchen) return;
    loadDishes(kitchen.id);
    loadMenu(kitchen.id, date);
  }, [kitchen?.id, date]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveDraft(): Promise<MenuDay | null> {
    if (!kitchen) return null;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        readyWindows: windows,
        items: Object.entries(portions).map(([dishId, portionsTotal]) => ({ dishId, portionsTotal })),
      };
      const res = menuDay
        ? await apiFetch(`/kitchens/${kitchen.id}/menu-days/${menuDay.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await apiFetch(`/kitchens/${kitchen.id}/menu-days`, {
            method: "POST",
            body: JSON.stringify({ date, ...payload }),
          });
      if (!res.ok) {
        const code = await errorCode(res);
        setError(explain(code));
        if (code === "MENU_DAY_EXISTS" || code === "MENU_DAY_NOT_DRAFT") loadMenu(kitchen.id, date);
        return null;
      }
      const day: MenuDay = await res.json();
      setMenuDay(day);
      setDirty(false);
      setNotice("Draft saved.");
      return day;
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!kitchen) return;
    let day = menuDay;
    if (dirty || !day) {
      day = await saveDraft();
      if (!day) return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch(`/kitchens/${kitchen.id}/menu-days/${day.id}/publish`, { method: "POST" });
      if (!res.ok) {
        setError(explain(await errorCode(res)));
        return;
      }
      setMenuDay(await res.json());
      setNotice("Menu published! Buyers within 10 miles can order now. 🎉");
    } finally {
      setSaving(false);
    }
  }

  /** Story 2.3 AC4 — live +/- correction on a published menu (adjusts portionsTotal). */
  async function adjustPortions(menuItemId: string, delta: number) {
    if (!kitchen) return;
    setError(null);
    const res = await apiFetch(`/inventory/menu-items/${menuItemId}/adjust`, {
      method: "POST",
      body: JSON.stringify({ delta }),
    });
    if (!res.ok) {
      setError(explain(await errorCode(res)));
      return;
    }
    loadMenu(kitchen.id, date);
  }

  if (session === undefined || (session?.role === "seller" && kitchen === undefined)) {
    return (
      <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
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
    return <CreateKitchenCard onCreated={loadKitchen} />;
  }

  const published = menuDay?.status === "published";
  const attested = !!kitchen!.complianceAttestedAt;

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 26, color: "var(--brand-green)" }}>Menus &amp; Portions</h1>
      <p style={{ margin: "0 0 20px", color: "var(--brand-muted)" }}>
        {kitchen!.name} — build your daily menu, set portions and ready windows, then publish.
      </p>

      {!attested && <AttestationCard kitchenId={kitchen!.id} onAttested={loadKitchen} />}

      <DishLibrary
        kitchenId={kitchen!.id}
        dishes={dishes}
        onChanged={() => loadDishes(kitchen!.id)}
        onError={(code) => setError(explain(code))}
      />

      <section className="card" style={{ marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 20, color: "var(--brand-green)" }}>Menu for</h2>
          <input
            type="date"
            className="field"
            style={{ width: "auto", margin: 0 }}
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="Menu date"
          />
          <span className={`badge ${published ? "hygiene" : "portions"}`}>
            {menuDay === undefined ? "loading…" : published ? "● Published" : menuDay ? "Draft" : "Not started"}
          </span>
        </div>

        {published ? (
          <>
            <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--brand-orange-dark)" }}>
              This menu is live — buyers see it now. Dishes and windows are locked; use +/− to correct
              portion counts (never below what&rsquo;s already ordered).
            </p>
            {error && (
              <div className="form-error" role="alert" style={{ marginTop: 12 }}>
                {error}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
              {menuDay!.items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    border: "1px solid var(--brand-border)",
                    borderRadius: 12,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: 15 }}>{item.dish.name}</strong>
                    <span style={{ color: "var(--brand-muted)", fontSize: 13 }}> · {money(item.dish.priceCents)}</span>
                    <span
                      style={{ display: "block", fontSize: 12, color: "var(--brand-muted)" }}
                      aria-live="polite"
                    >
                      {item.portionsRemaining} of {item.portionsTotal} left
                    </span>
                  </div>
                  <span className="qty-stepper" aria-label={`Correct portions for ${item.dish.name}`}>
                    <button aria-label="One portion fewer" onClick={() => adjustPortions(item.id, -1)}>
                      −
                    </button>
                    <span>{item.portionsTotal}</span>
                    <button aria-label="One portion more" onClick={() => adjustPortions(item.id, 1)}>
                      +
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <div className="pill-row" style={{ marginTop: 16 }} role="group" aria-label="Ready-time windows">
              {menuDay!.readyWindows.map((w, i) => (
                <span key={i} className="pill">
                  ⏰ {w.start}–{w.end} · {w.slotMinutes}-min slots
                </span>
              ))}
            </div>
          </>
        ) : (
          <>
            <h3 style={{ margin: "20px 0 8px", fontSize: 15 }}>1 · Pick dishes &amp; portions</h3>
            {dishes.length === 0 ? (
              <p style={{ margin: 0, color: "var(--brand-muted)", fontSize: 14 }}>
                Add a dish to your library above first.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {dishes.map((dish) => {
                  const included = portions[dish.id] !== undefined;
                  return (
                    <div
                      key={dish.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 12px",
                        border: "1px solid var(--brand-border)",
                        borderRadius: 12,
                        background: included ? "#fdf0e3" : "#fff",
                      }}
                    >
                      <input
                        type="checkbox"
                        id={`dish-${dish.id}`}
                        checked={included}
                        onChange={(e) => {
                          setPortions((p) => {
                            const next = { ...p };
                            if (e.target.checked) next[dish.id] = 8;
                            else delete next[dish.id];
                            return next;
                          });
                          setDirty(true);
                        }}
                        style={{ width: 18, height: 18, accentColor: "var(--brand-orange)" }}
                      />
                      <label htmlFor={`dish-${dish.id}`} style={{ flex: 1, cursor: "pointer" }}>
                        <strong style={{ fontSize: 15 }}>{dish.name}</strong>
                        <span style={{ color: "var(--brand-muted)", fontSize: 13 }}> · {money(dish.priceCents)}</span>
                      </label>
                      {included && (
                        <span className="qty-stepper" aria-label={`Portions for ${dish.name}`}>
                          <button
                            aria-label="Fewer portions"
                            disabled={portions[dish.id] <= 1}
                            onClick={() => {
                              setPortions((p) => ({ ...p, [dish.id]: p[dish.id] - 1 }));
                              setDirty(true);
                            }}
                          >
                            −
                          </button>
                          <span>{portions[dish.id]}</span>
                          <button
                            aria-label="More portions"
                            onClick={() => {
                              setPortions((p) => ({ ...p, [dish.id]: p[dish.id] + 1 }));
                              setDirty(true);
                            }}
                          >
                            +
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <h3 style={{ margin: "20px 0 8px", fontSize: 15 }}>2 · Ready-time windows</h3>
            {windows.map((w, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <input
                  type="time"
                  className="field"
                  style={{ width: "auto", margin: 0 }}
                  value={w.start}
                  aria-label="Window start"
                  onChange={(e) => {
                    setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)));
                    setDirty(true);
                  }}
                />
                <span>to</span>
                <input
                  type="time"
                  className="field"
                  style={{ width: "auto", margin: 0 }}
                  value={w.end}
                  aria-label="Window end"
                  onChange={(e) => {
                    setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)));
                    setDirty(true);
                  }}
                />
                <select
                  className="field"
                  style={{ width: "auto", margin: 0 }}
                  value={w.slotMinutes}
                  aria-label="Slot length"
                  onChange={(e) => {
                    setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, slotMinutes: Number(e.target.value) } : x)));
                    setDirty(true);
                  }}
                >
                  {[15, 30, 45, 60].map((m) => (
                    <option key={m} value={m}>
                      {m}-min slots
                    </option>
                  ))}
                </select>
                {windows.length > 1 && (
                  <button
                    className="btn-add"
                    aria-label="Remove window"
                    onClick={() => {
                      setWindows((ws) => ws.filter((_, j) => j !== i));
                      setDirty(true);
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button
              className="btn-add"
              onClick={() => {
                setWindows((ws) => [...ws, DEFAULT_WINDOW]);
                setDirty(true);
              }}
            >
              + Add window
            </button>

            <h3 style={{ margin: "20px 0 8px", fontSize: 15 }}>3 · Save &amp; publish</h3>
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
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                className="btn-add"
                style={{ padding: "12px 20px", fontSize: 15 }}
                disabled={saving || !dirty}
                onClick={saveDraft}
              >
                Save draft
              </button>
              <button
                className="btn-primary"
                style={{ width: "auto" }}
                disabled={saving || menuDay === undefined || Object.keys(portions).length === 0 || !attested}
                onClick={publish}
              >
                Publish menu
              </button>
            </div>
            {!attested && (
              <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--brand-muted)" }}>
                Publishing unlocks after you attest to compliance above.
              </p>
            )}
          </>
        )}
      </section>

      <PollsManager kitchenId={kitchen!.id} />

      <RequestsInbox kitchenId={kitchen!.id} />
    </main>
  );
}

/** Story 6.3 (FR18) — seller inbox for buyer dish requests; accept or decline. */
function RequestsInbox({ kitchenId }: { kitchenId: string }) {
  interface DishRequest {
    id: string;
    text: string;
    status: "open" | "accepted" | "declined";
    sellerNote: string | null;
    createdAt: string;
  }
  const [requests, setRequests] = useState<DishRequest[] | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch(`/kitchens/${kitchenId}/dish-requests`);
    if (res.ok) setRequests(await res.json());
  }, [kitchenId]);

  useEffect(() => {
    load();
  }, [load]);

  async function respond(id: string, status: "accepted" | "declined") {
    setBusyId(id);
    try {
      await apiFetch(`/dish-requests/${id}/respond`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const open = (requests ?? []).filter((r) => r.status === "open");
  const resolved = (requests ?? []).filter((r) => r.status !== "open");

  return (
    <section className="card" style={{ marginTop: 24 }}>
      <h2 style={{ margin: 0, fontSize: 20, color: "var(--brand-green)" }}>
        Dish requests{open.length > 0 && <span className="badge portions" style={{ marginLeft: 8 }}>{open.length} new</span>}
      </h2>
      <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--brand-muted)" }}>
        Buyers ask for dishes and cuisines. Accepting notifies the requester.
      </p>

      {requests?.length === 0 && (
        <p style={{ margin: "16px 0 0", color: "var(--brand-muted)", fontSize: 14 }}>No requests yet.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
        {open.map((r) => (
          <div key={r.id} style={{ border: "1px solid var(--brand-border)", borderRadius: 12, padding: 14 }}>
            <p style={{ margin: "0 0 10px" }}>“{r.text}”</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-accept" disabled={busyId === r.id} onClick={() => respond(r.id, "accepted")}>
                Accept
              </button>
              <button className="btn-decline" disabled={busyId === r.id} onClick={() => respond(r.id, "declined")}>
                Decline
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
            {resolved.map((r) => (
              <div
                key={r.id}
                style={{ border: "1px solid var(--brand-border)", borderRadius: 12, padding: "10px 14px", opacity: 0.8 }}
              >
                <span
                  className={`badge ${r.status === "accepted" ? "hygiene" : "soldout"}`}
                  style={{ marginRight: 8 }}
                >
                  {r.status}
                </span>
                “{r.text}”
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

/** Story 6.2 (FR17) — seller-side poll authoring + live results. */
function PollsManager({ kitchenId }: { kitchenId: string }) {
  interface Poll {
    id: string;
    question: string;
    options: string[];
    tallies: number[];
    totalVotes: number;
    closed: boolean;
    closesAt: string | null;
  }
  const [polls, setPolls] = useState<Poll[] | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch(`/kitchens/${kitchenId}/polls`);
    if (res.ok) setPolls(await res.json());
  }, [kitchenId]);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    const cleaned = options.map((o) => o.trim()).filter(Boolean);
    if (question.trim().length < 3 || cleaned.length < 2) {
      setError("Add a question and at least two options.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/kitchens/${kitchenId}/polls`, {
      method: "POST",
      body: JSON.stringify({ question: question.trim(), options: cleaned }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Could not create the poll.");
      return;
    }
    setQuestion("");
    setOptions(["", ""]);
    setCreating(false);
    load();
  }

  async function closePoll(id: string) {
    await apiFetch(`/polls/${id}/close`, { method: "POST" });
    load();
  }

  return (
    <section className="card" style={{ marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 20, color: "var(--brand-green)" }}>Menu polls</h2>
        <button className="btn-add" onClick={() => setCreating((c) => !c)}>
          {creating ? "Cancel" : "+ New poll"}
        </button>
      </div>
      <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--brand-muted)" }}>
        Ask buyers what to cook next. Each buyer votes once.
      </p>

      {creating && (
        <div
          style={{
            border: "1px solid var(--brand-border)",
            borderRadius: 12,
            padding: 16,
            marginTop: 16,
            background: "#fdf9f0",
          }}
        >
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <label>
            Question
            <input
              className="field"
              placeholder="Which dish should I add next week?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Options</span>
          {options.map((opt, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
              <input
                className="field"
                style={{ margin: 0 }}
                placeholder={`Option ${i + 1}`}
                value={opt}
                onChange={(e) => setOptions((os) => os.map((o, j) => (j === i ? e.target.value : o)))}
              />
              {options.length > 2 && (
                <button
                  className="btn-add"
                  aria-label={`Remove option ${i + 1}`}
                  onClick={() => setOptions((os) => os.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {options.length < 6 && (
            <button className="btn-add" style={{ marginTop: 8 }} onClick={() => setOptions((os) => [...os, ""])}>
              + Add option
            </button>
          )}
          <div style={{ marginTop: 12 }}>
            <button className="btn-primary" style={{ width: "auto" }} disabled={busy} onClick={create}>
              {busy ? "Creating…" : "Publish poll"}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
        {polls?.length === 0 && !creating && (
          <p style={{ margin: 0, color: "var(--brand-muted)", fontSize: 14 }}>No polls yet.</p>
        )}
        {polls?.map((poll) => (
          <div key={poll.id} style={{ border: "1px solid var(--brand-border)", borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <strong>{poll.question}</strong>
              {poll.closed ? (
                <span className="badge soldout">Closed</span>
              ) : (
                <button className="btn-add" onClick={() => closePoll(poll.id)}>
                  Close
                </button>
              )}
            </div>
            <div style={{ marginTop: 8 }}>
              {poll.options.map((opt, i) => {
                const votes = poll.tallies[i] ?? 0;
                const pct = poll.totalVotes ? Math.round((votes / poll.totalVotes) * 100) : 0;
                return <PollBar key={i} label={opt} votes={votes} pct={pct} />;
              })}
            </div>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--brand-muted)" }}>
              {poll.totalVotes} vote{poll.totalVotes === 1 ? "" : "s"}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Horizontal result bar shared by the seller manager and the buyer poll card. */
function PollBar({ label, votes, pct }: { label: string; votes: number; pct: number }) {
  return (
    <div style={{ margin: "4px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ color: "var(--brand-muted)" }}>
          {pct}% · {votes}
        </span>
      </div>
      <div style={{ background: "var(--brand-border)", borderRadius: 999, height: 8, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--brand-orange)" }} />
      </div>
    </div>
  );
}

/** FR1 onboarding — shown until the seller has a kitchen. The address is geocoded
 * server-side (Story 1.3 AC1); manual lat/lng only appear after GEOCODING_FAILED (AC4). */
function CreateKitchenCard({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    name: "",
    cuisineTag: "turkish",
    description: "",
    address: "",
  });
  const [needManualGeo, setNeedManualGeo] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = { ...form };
    if (needManualGeo && lat && lng) {
      payload.lat = Number(lat);
      payload.lng = Number(lng);
    }
    const res = await apiFetch("/kitchens", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (body.message === "GEOCODING_FAILED") {
        setNeedManualGeo(true);
        setError("We couldn't locate that address. Check it, or enter coordinates below.");
      } else {
        setError("Could not create the kitchen. Fill every field and try again.");
      }
      return;
    }
    onCreated();
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "32px 24px" }}>
      <form className="card" onSubmit={submit}>
        <h1 style={{ margin: "0 0 4px", fontSize: 24, color: "var(--brand-green)" }}>Set up your kitchen</h1>
        <p style={{ margin: "0 0 20px", color: "var(--brand-muted)", fontSize: 14 }}>
          One quick step before you can build your first menu.
        </p>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <label>
          Kitchen name
          <input className="field" required minLength={2} value={form.name} onChange={set("name")} />
        </label>
        <label>
          Cuisine
          <select className="field" value={form.cuisineTag} onChange={set("cuisineTag")}>
            {CUISINES.map((c) => (
              <option key={c.tag} value={c.tag}>
                {c.icon} {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Description
          <input className="field" required value={form.description} onChange={set("description")} />
        </label>
        <label>
          Home address <span style={{ color: "var(--brand-muted)" }}>(encrypted; never shown publicly)</span>
          <input
            className="field"
            required
            placeholder="Street, city, state"
            value={form.address}
            onChange={(e) => {
              setForm((f) => ({ ...f, address: e.target.value }));
              setNeedManualGeo(false);
            }}
          />
        </label>
        {needManualGeo && (
          <div style={{ display: "flex", gap: 12 }}>
            <label style={{ flex: 1 }}>
              Latitude
              <input className="field" required value={lat} onChange={(e) => setLat(e.target.value)} />
            </label>
            <label style={{ flex: 1 }}>
              Longitude
              <input className="field" required value={lng} onChange={(e) => setLng(e.target.value)} />
            </label>
          </div>
        )}
        <button className="btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Create kitchen"}
        </button>
      </form>
    </main>
  );
}

/** FR2 — compliance attestation gate; publishing stays locked until done. */
function AttestationCard({ kitchenId, onAttested }: { kitchenId: string; onAttested: () => void }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  async function attest() {
    setBusy(true);
    const res = await apiFetch(`/kitchens/${kitchenId}/attestation`, { method: "POST" });
    setBusy(false);
    if (res.ok) onAttested();
  }

  return (
    <section className="card" style={{ marginBottom: 24, borderColor: "var(--brand-orange)" }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 18, color: "var(--brand-orange-dark)" }}>
        ⚠ Compliance attestation required
      </h2>
      <p style={{ margin: "0 0 12px", fontSize: 14 }}>
        You can prepare draft menus now, but publishing is locked until you attest to your local
        cottage-food / MEHKO compliance.
      </p>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, marginBottom: 14 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          style={{ marginTop: 3, width: 16, height: 16, accentColor: "var(--brand-orange)" }}
        />
        <span>
          I confirm my kitchen operates under a valid local cottage-food or MEHKO permit and complies
          with all applicable home-kitchen regulations.
        </span>
      </label>
      <button className="btn-primary" style={{ width: "auto" }} disabled={!checked || busy} onClick={attest}>
        {busy ? "Submitting…" : "Attest compliance"}
      </button>
    </section>
  );
}

/** FR3 dish library — dishes are reused across menu days. */
function DishLibrary({
  kitchenId,
  dishes,
  onChanged,
  onError,
}: {
  kitchenId: string;
  dishes: Dish[];
  onChanged: () => void;
  onError: (code: string | undefined) => void;
}) {
  const [editing, setEditing] = useState<Dish | "new" | null>(null);

  async function remove(dish: Dish) {
    const res = await apiFetch(`/kitchens/${kitchenId}/dishes/${dish.id}`, { method: "DELETE" });
    if (!res.ok) {
      onError(await errorCode(res));
      return;
    }
    onChanged();
  }

  return (
    <section className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 20, color: "var(--brand-green)" }}>Dish library</h2>
        <button className="btn-add" onClick={() => setEditing(editing === "new" ? null : "new")}>
          {editing === "new" ? "Cancel" : "+ New dish"}
        </button>
      </div>

      {editing === "new" && (
        <DishForm kitchenId={kitchenId} onDone={() => { setEditing(null); onChanged(); }} />
      )}

      {dishes.length === 0 && editing !== "new" && (
        <p style={{ margin: "16px 0 0", color: "var(--brand-muted)", fontSize: 14 }}>
          No dishes yet — add your first dish to start building menus.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
        {dishes.map((dish) =>
          editing !== "new" && editing?.id === dish.id ? (
            <DishForm
              key={dish.id}
              kitchenId={kitchenId}
              dish={dish}
              onDone={() => { setEditing(null); onChanged(); }}
            />
          ) : (
            <div key={dish.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                className="kitchen-photo"
                style={{ width: 52, height: 52, borderRadius: 10, fontSize: 22, flexShrink: 0 }}
              >
                {dish.photo ? <img src={dish.photo} alt="" /> : "🍽️"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 15 }}>{dish.name}</strong>
                <span style={{ color: "var(--brand-muted)", fontSize: 13 }}> · {money(dish.priceCents)}</span>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                  {dish.dietaryTags.map((t) => (
                    <span key={t} className="badge hygiene">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <button className="btn-add" onClick={() => setEditing(dish)}>
                Edit
              </button>
              <button className="btn-add" aria-label={`Delete ${dish.name}`} onClick={() => remove(dish)}>
                🗑
              </button>
            </div>
          ),
        )}
      </div>
    </section>
  );
}

function DishForm({ kitchenId, dish, onDone }: { kitchenId: string; dish?: Dish; onDone: () => void }) {
  const [form, setForm] = useState({
    name: dish?.name ?? "",
    description: dish?.description ?? "",
    photo: dish?.photo ?? "",
    price: dish ? (dish.priceCents / 100).toFixed(2) : "",
    dietaryTags: dish?.dietaryTags ?? [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const priceCents = Math.round(parseFloat(form.price) * 100);
    if (!Number.isFinite(priceCents) || priceCents < 1) {
      setError("Enter a price like 12.50.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await apiFetch(
      dish ? `/kitchens/${kitchenId}/dishes/${dish.id}` : `/kitchens/${kitchenId}/dishes`,
      {
        method: dish ? "PATCH" : "POST",
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          photo: form.photo || undefined,
          priceCents,
          dietaryTags: form.dietaryTags,
        }),
      },
    );
    setBusy(false);
    if (!res.ok) {
      setError("Could not save the dish.");
      return;
    }
    onDone();
  }

  return (
    <form
      onSubmit={submit}
      style={{
        border: "1px solid var(--brand-border)",
        borderRadius: 12,
        padding: 16,
        marginTop: 16,
        background: "#fdf9f0",
      }}
    >
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label style={{ flex: 2, minWidth: 180 }}>
          Dish name
          <input
            className="field"
            required
            minLength={2}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </label>
        <label style={{ flex: 1, minWidth: 100 }}>
          Price ($)
          <input
            className="field"
            required
            inputMode="decimal"
            placeholder="12.50"
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
          />
        </label>
      </div>
      <label>
        Description
        <input
          className="field"
          required
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </label>
      <label>
        Photo URL <span style={{ color: "var(--brand-muted)" }}>(optional)</span>
        <input
          className="field"
          value={form.photo}
          onChange={(e) => setForm((f) => ({ ...f, photo: e.target.value }))}
        />
      </label>
      <div className="pill-row" role="group" aria-label="Dietary tags">
        {DIETARY_TAGS.map((tag) => {
          const on = form.dietaryTags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              className="pill"
              aria-pressed={on}
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  dietaryTags: on ? f.dietaryTags.filter((t) => t !== tag) : [...f.dietaryTags, tag],
                }))
              }
            >
              {tag}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <button className="btn-primary" style={{ width: "auto" }} disabled={busy}>
          {busy ? "Saving…" : dish ? "Save dish" : "Add dish"}
        </button>
        <button type="button" className="btn-add" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
