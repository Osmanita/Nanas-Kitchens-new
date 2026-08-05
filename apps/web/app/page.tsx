"use client";

/** Buyer Home — chat-first landing (hero matches /chat's glass design system) with the
 * nearby-kitchens browser (front-end-spec.md, FR5) underneath. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { API } from "../lib/api";
import { CUISINES, CUISINE_ICONS } from "../lib/cuisines";
import { getLocation, saveLocation, type PickedLocation } from "../lib/location";
import LocationPickerModal from "./components/LocationPickerModal";

const HERO_SUGGESTIONS = [
  "Find Turkish food near me",
  "What's cooking in Powell today?",
  "I want to order something vegetarian",
];

/** Read by /chat on mount — lets Home hand off the buyer's first message so they land
 * straight in an already-started conversation instead of an empty chat screen. */
const PENDING_MESSAGE_KEY = "pendingChatMessage";

interface KitchenResult {
  id: string;
  name: string;
  cuisineTag: string;
  distanceMiles: number;
  ratingAvg: number | null;
  hygieneScore: number | null;
  portionsLeftToday: number;
  photo: string | null;
}

export default function BuyerHome() {
  const router = useRouter();
  const [heroInput, setHeroInput] = useState("");
  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cuisine, setCuisine] = useState<string | null>(null);
  // Unfiltered — the cuisine pills and the grid both derive from this so picking a cuisine
  // never makes the OTHER pills disappear, and cuisines with zero nearby kitchens never show.
  const [kitchens, setKitchens] = useState<KitchenResult[] | null>(null);
  const [error, setError] = useState(false);

  const availableCuisines = CUISINES.filter((c) => kitchens?.some((k) => k.cuisineTag === c.tag));
  const visibleKitchens = kitchens && (cuisine ? kitchens.filter((k) => k.cuisineTag === cuisine) : kitchens);

  // No silent browser geolocation prompt — ask explicitly via the picker so buyers can
  // choose "use my location", drop a pin on the map, or type an address instead.
  useEffect(() => {
    const saved = getLocation();
    if (saved) {
      setLocation(saved);
    } else {
      setPickerOpen(true);
    }
  }, []);

  function confirmLocation(loc: PickedLocation) {
    saveLocation(loc);
    setLocation(loc);
    setPickerOpen(false);
  }

  // Home doesn't run the chat conversation itself — it just stashes the first message and
  // hands off to /chat, which sends it automatically on arrival (see that page's mount effect).
  function goToChat(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    sessionStorage.setItem(PENDING_MESSAGE_KEY, trimmed);
    router.push("/chat");
  }

  function onHeroSubmit(e: FormEvent) {
    e.preventDefault();
    goToChat(heroInput);
  }

  useEffect(() => {
    if (!location) return;
    let cancelled = false;
    setKitchens(null);
    setError(false);
    setCuisine(null); // a new location may not have the previously picked cuisine nearby
    const qs = new URLSearchParams({ lat: String(location.lat), lng: String(location.lng) });
    fetch(`${API}/kitchens/search?${qs}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((rows) => !cancelled && setKitchens(rows))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [location]);

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "14px 24px 32px", position: "relative" }}>
      <div className="hero-glow" aria-hidden="true" style={{ opacity: 0.5 }} />
      <LocationPickerModal
        open={pickerOpen}
        onClose={location ? () => setPickerOpen(false) : undefined}
        onConfirm={confirmLocation}
      />

      <section className="fade-up" style={{ textAlign: "center", padding: "5vh 0 40px" }}>
        <div className="halo-orb stagger" style={{ "--i": 0 } as React.CSSProperties}>
          N
        </div>
        <h1
          className="stagger"
          style={
            {
              "--i": 1,
              fontSize: "clamp(26px, 4vw, 34px)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              margin: "0 0 10px",
            } as React.CSSProperties
          }
        >
          What are you <span className="hero-em">craving</span> today?
        </h1>
        <p
          className="stagger"
          style={{ "--i": 2, color: "var(--text-2)", fontSize: 15.5, margin: "0 0 26px" } as React.CSSProperties}
        >
          Tell the AI what you want, or browse nearby kitchens below.
        </p>

        <form
          onSubmit={onHeroSubmit}
          className="chat-dock stagger"
          style={{ "--i": 3, maxWidth: 560, margin: "0 auto" } as React.CSSProperties}
        >
          <input
            value={heroInput}
            onChange={(e) => setHeroInput(e.target.value)}
            placeholder="Ask for a cuisine, a dish, or say what you're in the mood for…"
            aria-label="Ask the AI ordering assistant"
          />
          <button type="submit" className="send-orb" disabled={!heroInput.trim()} aria-label="Start chatting">
            ➤
          </button>
        </form>

        <div
          className="stagger"
          style={
            {
              "--i": 4,
              display: "flex",
              gap: 10,
              justifyContent: "center",
              flexWrap: "wrap",
              marginTop: 16,
            } as React.CSSProperties
          }
        >
          {HERO_SUGGESTIONS.map((s) => (
            <button key={s} className="chip" onClick={() => goToChat(s)}>
              {s}
            </button>
          ))}
        </div>
      </section>

      <h2 style={{ margin: "0 0 4px", fontSize: 20, color: "var(--brand-green)" }}>
        Or browse nearby kitchens
      </h2>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          margin: "0 0 16px",
        }}
      >
        <p style={{ margin: 0, color: "var(--brand-muted)" }}>
          Made with ❤ near you — homemade meals within 10 miles of{" "}
          <strong>{location?.label ?? "…"}</strong>
        </p>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            border: "1px solid var(--brand-border)",
            background: "#fff",
            color: "var(--brand-ink)",
            borderRadius: 999,
            padding: "6px 14px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          📍 Change location
        </button>
      </div>

      {availableCuisines.length > 0 && (
        <div className="pill-row" role="group" aria-label="Cuisine filter">
          <button className="pill" aria-pressed={cuisine === null} onClick={() => setCuisine(null)}>
            ✨ All
          </button>
          {availableCuisines.map((c) => (
            <button
              key={c.tag}
              className="pill"
              aria-pressed={cuisine === c.tag}
              onClick={() => setCuisine(c.tag)}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="form-error" role="alert">
          Could not load kitchens. Is the API running?
        </div>
      )}

      {!error && kitchens === null && (
        <div className="kitchen-grid" aria-label="Loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" />
          ))}
        </div>
      )}

      {!error && visibleKitchens !== null && visibleKitchens.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <p style={{ fontSize: 40, margin: 0 }}>🥘</p>
          <p style={{ fontWeight: 600, margin: "8px 0 4px" }}>No kitchens in your area yet</p>
          <p style={{ color: "var(--brand-muted)", margin: 0 }}>
            Ask the <Link href="/chat">agent</Link> to notify you when a neighbor starts cooking.
          </p>
        </div>
      )}

      {!error && visibleKitchens !== null && visibleKitchens.length > 0 && (
        <div className="kitchen-grid">
          {visibleKitchens.map((k) => {
            const soldOut = k.portionsLeftToday === 0;
            return (
              <Link
                key={k.id}
                href={`/kitchens/${k.id}`}
                className={`kitchen-card${soldOut ? " sold-out" : ""}`}
              >
                <div className="kitchen-photo" aria-hidden>
                  {k.photo ? <img src={k.photo} alt="" loading="lazy" /> : CUISINE_ICONS[k.cuisineTag] ?? "🍽️"}
                  <span className="flag-tag">{CUISINE_ICONS[k.cuisineTag] ?? "🍽️"}</span>
                </div>
                <div style={{ padding: "12px 16px 16px" }}>
                  <strong style={{ fontSize: 16 }}>{k.name}</strong>
                  <div style={{ margin: "4px 0 8px", fontSize: 13, color: "var(--brand-muted)" }}>
                    {k.cuisineTag[0].toUpperCase() + k.cuisineTag.slice(1)} · {k.distanceMiles} mi ·{" "}
                    {k.ratingAvg != null ? `★ ${k.ratingAvg.toFixed(1)}` : "New"}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {k.hygieneScore != null && (
                      <span className="badge hygiene">🛡 Hygiene {k.hygieneScore}</span>
                    )}
                    {soldOut ? (
                      <span className="badge soldout">Sold out today</span>
                    ) : (
                      <span className="badge portions">{k.portionsLeftToday} portions left today</span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
