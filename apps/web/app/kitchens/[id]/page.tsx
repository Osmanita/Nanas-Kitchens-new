"use client";

/** Kitchen Profile (front-end-spec.md, FR1/FR6/FR16-19): photos, hygiene badge,
 * description, today's live menu, reviews (Story 6.1), menu polls (Story 6.2) and
 * a "Request a dish" prompt (Story 6.3). */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { API, apiFetch, getSession } from "../../../lib/api";
import { CUISINE_ICONS, CUISINE_LABELS } from "../../../lib/cuisines";
import {
  addLine,
  Cart,
  cartCount,
  cartSubtotalCents,
  getCart,
  money,
  setQty,
  subscribeCart,
} from "../../../lib/cart";

import styles from "../../marketplace.module.css";

interface KitchenProfile {
  id: string;
  name: string;
  cuisineTag: string;
  description: string | null;
  photos: string[];
  ratingAvg: number | null;
  ratingCount: number;
  hygieneScoreTotal: number | null;
  hygieneScoredAt: string | null;
  complianceAttestedAt: string | null;
}

interface Dish {
  id: string;
  name: string;
  description: string | null;
  photo: string | null;
  priceCents: number;
  dietaryTags: string[];
}

interface MenuItem {
  id: string;
  portionsTotal: number;
  portionsRemaining: number;
  dish: Dish;
}

interface ReadyWindow {
  start: string;
  end: string;
  slotMinutes: number;
}

interface MenuDay {
  id: string;
  date: string;
  status: string;
  readyWindows: ReadyWindow[];
  items: MenuItem[];
}

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

interface HealthReport {
  id: string;
  fileUrl: string;
  filename: string;
  uploadedAt: string;
}

export default function KitchenProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<KitchenProfile | null | "error">(null);
  const [menu, setMenu] = useState<MenuDay | null | undefined>(undefined);
  const [remaining, setRemaining] = useState<Record<string, number>>({});
  const [cart, setCart] = useState<Cart | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [healthReports, setHealthReports] = useState<HealthReport[]>([]);

  useEffect(() => {
    setCart(getCart());
    return subscribeCart(() => setCart(getCart()));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/kitchens/${id}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body) => !cancelled && setProfile(body))
      .catch(() => !cancelled && setProfile("error"));
    fetch(`${API}/kitchens/${id}/menu`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body) => !cancelled && setMenu(body))
      .catch(() => !cancelled && setMenu(null));
    fetch(`${API}/kitchens/${id}/reviews`)
      .then((res) => (res.ok ? res.json() : []))
      .then((body) => !cancelled && setReviews(body))
      .catch(() => {});
    fetch(`${API}/kitchens/${id}/health-reports`)
      .then((res) => (res.ok ? res.json() : []))
      .then((body) => !cancelled && setHealthReports(body))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Story 2.3 AC3: live portion counts via SSE, falling back to 10 s polling.
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let opened = false;
    const source = new EventSource(`${API}/kitchens/${id}/portions/stream`);
    source.addEventListener("portions", (evt) => {
      opened = true;
      const payload = JSON.parse((evt as MessageEvent).data) as {
        items: { id: string; portionsRemaining: number }[];
      };
      setRemaining((prev) => {
        const next = { ...prev };
        for (const item of payload.items) next[item.id] = item.portionsRemaining;
        return next;
      });
    });
    source.onerror = () => {
      if (!opened && !pollTimer) {
        pollTimer = setInterval(() => {
          fetch(`${API}/kitchens/${id}/menu`)
            .then((res) => (res.ok ? res.json() : null))
            .then((body: MenuDay | null) => body && setMenu(body));
        }, 10000);
      }
    };
    return () => {
      source.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [id]);

  if (profile === "error") {
    return (
      <main className={`${styles.page} ${styles.compact}`}>
        <div className="form-error" role="alert">
          Could not load this kitchen. It may not exist.
        </div>
        <Link href="/">‹ Back to nearby kitchens</Link>
      </main>
    );
  }

  if (profile === null) {
    return (
      <main className={`${styles.page} ${styles.compact}`}>
        <div className="skeleton" style={{ height: 260, marginBottom: 24 }} />
      </main>
    );
  }

  const heroPhoto = profile.photos[0];
  const cuisineIcon = CUISINE_ICONS[profile.cuisineTag] ?? "🍽️";
  const cuisineLabel = CUISINE_LABELS[profile.cuisineTag] ?? profile.cuisineTag;

  return (
    <main className={`${styles.page} ${styles.compact}`}>
      <Link href="/" className={styles.back}>
        ‹ Back to nearby kitchens
      </Link>

      <div className={`kitchen-photo ${styles.cover}`}>
        {heroPhoto ? <img src={heroPhoto} alt={`Food from ${profile.name}`} /> : cuisineIcon}
      </div>
      {profile.photos.length > 1 && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, overflowX: "auto" }}>
          {profile.photos.slice(1).map((src) => (
            <img
              key={src}
              src={src}
              alt=""
              style={{ width: 72, height: 72, borderRadius: 10, objectFit: "cover", flexShrink: 0 }}
            />
          ))}
        </div>
      )}

      <h1 className={styles.profileTitle}>{profile.name}</h1>
      <div style={{ color: "var(--brand-muted)", fontSize: 14, marginBottom: 10 }}>
        {cuisineIcon} {cuisineLabel} ·{" "}
        {profile.ratingAvg != null ? `★ ${profile.ratingAvg.toFixed(1)} (${profile.ratingCount})` : "New kitchen"}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {profile.hygieneScoreTotal != null ? (
          <span className="badge hygiene">
            🛡 Hygiene {profile.hygieneScoreTotal}
            {profile.hygieneScoredAt &&
              ` · inspected ${new Date(profile.hygieneScoredAt).toLocaleDateString()}`}
          </span>
        ) : (
          <span className="badge soldout">Not yet inspected</span>
        )}
      </div>

      {/* Story 7.1 (FR19) — health/permit documents with upload dates. */}
      {healthReports.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {healthReports.map((r) => (
            <a
              key={r.id}
              href={r.fileUrl}
              target="_blank"
              rel="noreferrer"
              className="badge hygiene"
              style={{ textDecoration: "none" }}
            >
              📄 {r.filename} · {new Date(r.uploadedAt).toLocaleDateString()}
            </a>
          ))}
        </div>
      )}

      {profile.description && (
        <p style={{ color: "var(--brand-ink)", lineHeight: 1.5 }}>{profile.description}</p>
      )}

      <h2 style={{ fontSize: 20, color: "var(--brand-green)", marginTop: 28 }}>Today’s menu</h2>

      {menu === undefined && (
        <div className="kitchen-grid">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}

      {menu === null && (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <p style={{ fontSize: 36, margin: 0 }}>📭</p>
          <p style={{ fontWeight: 600, margin: "8px 0 4px" }}>No menu published today</p>
          <p style={{ color: "var(--brand-muted)", margin: 0 }}>
            Ask the <Link href="/chat">agent</Link> to notify you when {profile.name} publishes one.
          </p>
        </div>
      )}

      {menu && (
        <>
          {menu.readyWindows?.length > 0 && (
            <div className="pill-row" role="group" aria-label="Ready-time windows">
              {menu.readyWindows.map((w, i) => (
                <span key={i} className="pill" aria-pressed="false">
                  ⏰ {w.start}–{w.end}
                </span>
              ))}
            </div>
          )}

          <div className="kitchen-grid">
            {menu.items.map((item) => {
              const left = remaining[item.id] ?? item.portionsRemaining;
              const soldOut = left <= 0;
              const inCart = cart?.lines.find((l) => l.menuItemId === item.id)?.qty ?? 0;
              return (
                <div key={item.id} className={`kitchen-card${soldOut ? " sold-out" : ""}`}>
                  <div className="kitchen-photo">
                    {item.dish.photo ? <img src={item.dish.photo} alt={item.dish.name} loading="lazy" /> : "🍽️"}
                  </div>
                  <div style={{ padding: "12px 16px 16px" }}>
                    <strong style={{ fontSize: 16 }}>{item.dish.name}</strong>
                    {item.dish.description && (
                      <p style={{ margin: "4px 0 8px", fontSize: 13, color: "var(--brand-muted)" }}>
                        {item.dish.description}
                      </p>
                    )}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                      {item.dish.dietaryTags.map((tag) => (
                        <span key={tag} className="badge hygiene">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <strong>{money(item.dish.priceCents)}</strong>
                      {soldOut ? (
                        <span className="badge soldout">Sold out</span>
                      ) : inCart > 0 ? (
                        <span className="qty-stepper">
                          <button aria-label="Remove one" onClick={() => setQty(item.id, inCart - 1)}>
                            −
                          </button>
                          <span aria-live="polite">{inCart}</span>
                          <button
                            aria-label="Add one"
                            disabled={inCart >= left}
                            onClick={() => setQty(item.id, inCart + 1)}
                          >
                            +
                          </button>
                        </span>
                      ) : (
                        <button
                          className="btn-add"
                          onClick={() =>
                            addLine(
                              {
                                kitchenId: profile.id,
                                kitchenName: profile.name,
                                menuDayId: menu.id,
                                menuDate: menu.date,
                              },
                              {
                                menuItemId: item.id,
                                dishName: item.dish.name,
                                priceCents: item.dish.priceCents,
                                photo: item.dish.photo,
                                qty: 1,
                              },
                            )
                          }
                        >
                          Add
                        </button>
                      )}
                    </div>
                    {!soldOut && (
                      <div style={{ marginTop: 6, fontSize: 12, color: "var(--brand-muted)" }}>
                        {left} left
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <Link
            href="/chat"
            className="card"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginTop: 24,
              textDecoration: "none",
              color: "var(--brand-ink)",
            }}
          >
            <span style={{ fontSize: 32 }}>💬</span>
            <span>
              <strong>A little help choosing?</strong>
              <br />
              <span style={{ color: "var(--brand-muted)", fontSize: 14 }}>
                Ask Nana what you’d like from {profile.name} and a ready time.
              </span>
            </span>
          </Link>
        </>
      )}

<section className={styles.panel} style={{ marginTop: 28 }}><h2>Help choose tomorrow’s meal</h2><p className={styles.muted}>Vote in nearby kitchen polls and reserve your portions. Payment opens when the cook confirms the menu.</p><Link className={styles.button} href="/voting">Explore tomorrow’s polls →</Link></section>

      {/* Story 6.3 (FR18) — buyers ask the kitchen for a dish/cuisine. */}
      <DishRequestPrompt kitchenId={profile.id} kitchenName={profile.name} />

      {/* Story 6.1 (FR16) — verified post-completion reviews; identity stays private. */}
      <h2 style={{ fontSize: 20, color: "var(--brand-green)", marginTop: 28 }}>
        Reviews{profile.ratingAvg != null && ` · ★ ${profile.ratingAvg.toFixed(1)} (${profile.ratingCount})`}
      </h2>
      {reviews.length === 0 ? (
        <p style={{ color: "var(--brand-muted)", fontSize: 14 }}>
          No reviews yet — reviews unlock after a completed order.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {reviews.map((r) => (
            <div key={r.id} className="card" style={{ padding: "14px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ color: "var(--brand-orange)", letterSpacing: 1 }} aria-label={`${r.rating} of 5 stars`}>
                  {"★".repeat(r.rating)}
                  <span style={{ color: "var(--brand-border)" }}>{"★".repeat(5 - r.rating)}</span>
                </span>
                <span style={{ fontSize: 12, color: "var(--brand-muted)" }}>
                  Verified buyer · {new Date(r.createdAt).toLocaleDateString()}
                </span>
              </div>
              {r.comment && <p style={{ margin: "6px 0 0", fontSize: 14 }}>{r.comment}</p>}
            </div>
          ))}
        </div>
      )}

      {cart && cart.kitchenId === profile.id && cartCount(cart) > 0 && (
        <Link href="/checkout" className="cart-bar">
          <span>
            🛒 {cartCount(cart)} item{cartCount(cart) === 1 ? "" : "s"} ·{" "}
            {money(cartSubtotalCents(cart))}
          </span>
          <span>View cart →</span>
        </Link>
      )}
    </main>
  );
}

/** Story 6.3 (FR18) — "Request a dish" prompt. Buyers submit; others see a hint. */
function DishRequestPrompt({ kitchenId, kitchenName }: { kitchenId: string; kitchenName: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = getSession();

  async function submit() {
    if (text.trim().length < 3) {
      setError("Tell the kitchen what you'd like (a few words).");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/kitchens/${kitchenId}/dish-requests`, {
      method: "POST",
      body: JSON.stringify({ text: text.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Could not send your request — try again.");
      return;
    }
    setSent(true);
    setText("");
  }

  return (
    <div className="card" style={{ marginTop: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <strong style={{ fontSize: 16 }}>Craving something not on the menu?</strong>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--brand-muted)" }}>
            Request a dish or cuisine and {kitchenName} may add it to a future menu.
          </p>
        </div>
        {!open && !sent && session?.role === "buyer" && (
          <button className="btn-add" onClick={() => setOpen(true)}>
            Request a dish
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
          Request sent! You&rsquo;ll be notified if {kitchenName} adds it. 🎉
        </div>
      )}

      {open && !sent && (
        <div style={{ marginTop: 12 }}>
          <textarea
            className="field"
            rows={3}
            maxLength={500}
            placeholder="e.g. Could you make Adana kebap next week?"
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn-primary" style={{ width: "auto" }} disabled={busy} onClick={submit}>
              {busy ? "Sending…" : "Send request"}
            </button>
            <button className="btn-add" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {!session && (
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--brand-muted)" }}>
          <Link href={`/login?next=/kitchens/${kitchenId}`}>Log in</Link> as a buyer to request a dish.
        </p>
      )}
    </div>
  );
}
