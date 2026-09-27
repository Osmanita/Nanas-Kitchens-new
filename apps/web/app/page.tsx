"use client";

/** Buyer Home — chat-first landing (hero matches /chat's glass design system) with the
 * nearby-kitchens browser (front-end-spec.md, FR5) underneath. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { API } from "../lib/api";
import { CUISINES } from "../lib/cuisines";
import {
  getLocation,
  saveLocation,
  type PickedLocation,
} from "../lib/location";
import LocationPickerModal from "./components/LocationPickerModal";

import Icon from "./components/Icon";
import { EmptyState } from "./components/PageKit";
import styles from "./marketplace.module.css";

const HERO_SUGGESTIONS = [
  "Find Turkish food near me",
  "What's cooking near me today?",
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

  const availableCuisines = CUISINES.filter((c) =>
    kitchens?.some((k) => k.cuisineTag === c.tag),
  );
  const visibleKitchens =
    kitchens &&
    (cuisine ? kitchens.filter((k) => k.cuisineTag === cuisine) : kitchens);

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
    const qs = new URLSearchParams({
      lat: String(location.lat),
      lng: String(location.lng),
    });
    fetch(`${API}/kitchens/search?${qs}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((rows) => !cancelled && setKitchens(rows))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [location]);

  return (
    <main className={styles.page}>
      <LocationPickerModal
        open={pickerOpen}
        onClose={location ? () => setPickerOpen(false) : undefined}
        onConfirm={confirmLocation}
      />
      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>
            A seat at your neighbor’s table
          </span>
          <h1 className={styles.heroTitle}>
            Good food.
            <br />A little closer
            <br />
            <em>to home.</em>
          </h1>
          <p className={styles.heroCopy}>
            Family recipes, made in local kitchens. Find a familiar favorite or
            let Nana help you try something new.
          </p>
          <form onSubmit={onHeroSubmit} className={styles.search}>
            <input
              value={heroInput}
              onChange={(e) => setHeroInput(e.target.value)}
              placeholder="What are you craving today?"
              aria-label="Ask Nana what to eat"
            />
            <button
              type="submit"
              disabled={!heroInput.trim()}
              aria-label="Start chatting"
            >
              <Icon name="arrow" />
            </button>
          </form>
          <div className={styles.suggestions}>
            {HERO_SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => goToChat(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <figure className={styles.heroImage}>
          <img
            src="/dishes/sarma.jpg"
            alt="A plate of home-style stuffed vegetables"
            fetchPriority="high"
          />
          <figcaption className={styles.caption}>
            <div>
              <strong>Recipes with a story.</strong>
              <small>Discover the people behind your next meal.</small>
            </div>
            <Icon name="bowl" width={28} height={28} />
          </figcaption>
        </figure>
      </section>
      <section aria-labelledby="nearby-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="nearby-title" className={styles.sectionTitle}>
              From kitchens near you
            </h2>
            <p className={styles.muted}>
              Explore today’s menus, all within 10 miles.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className={styles.secondary + " " + styles.location}
            aria-label="Change location"
          >
            <Icon name="pin" />
            <span>{location?.label ?? "Choose your location"}</span>
            <Icon name="chevron" width={16} />
          </button>
        </div>
        {availableCuisines.length > 0 && (
          <div className="pill-row" role="group" aria-label="Cuisine filter">
            <button
              className="pill"
              aria-pressed={cuisine === null}
              onClick={() => setCuisine(null)}
            >
              All kitchens
            </button>
            {availableCuisines.map((c) => (
              <button
                key={c.tag}
                className="pill"
                aria-pressed={cuisine === c.tag}
                onClick={() => setCuisine(c.tag)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        {error && (
          <div className="form-error" role="alert">
            We couldn’t load nearby kitchens.{" "}
            <button onClick={() => setLocation(location && { ...location })}>
              Try again
            </button>
          </div>
        )}
        {!error && kitchens === null && (
          <div
            className={styles.kitchenGrid}
            aria-label="Loading kitchens"
            aria-busy="true"
          >
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" />
            ))}
          </div>
        )}
        {!error && visibleKitchens?.length === 0 && (
          <EmptyState
            title="A new neighborhood to discover"
            action={
              <button
                className={styles.secondary}
                onClick={() => setPickerOpen(true)}
              >
                Try another location
              </button>
            }
          >
            No kitchens are serving in this area yet. Choose a nearby location
            to see what’s cooking.
          </EmptyState>
        )}
        {!error && visibleKitchens && visibleKitchens.length > 0 && (
          <div className={styles.kitchenGrid}>
            {visibleKitchens.map((k) => (
              <Link
                key={k.id}
                href={`/kitchens/${k.id}`}
                className={styles.kitchenCard}
              >
                <div className={styles.kitchenImage}>
                  {k.photo ? (
                    <img
                      src={k.photo}
                      alt={`Food from ${k.name}`}
                      loading="lazy"
                    />
                  ) : (
                    <Icon name="bowl" width={48} height={48} />
                  )}
                  <span className={styles.availability}>
                    {k.portionsLeftToday === 0
                      ? "Sold out today"
                      : "Cooking today"}
                  </span>
                </div>
                <h3>{k.name}</h3>
                <p>
                  {k.cuisineTag[0].toUpperCase() + k.cuisineTag.slice(1)} ·{" "}
                  {k.distanceMiles} mi away
                </p>
                <div className={styles.kitchenMeta}>
                  <span>
                    {k.ratingAvg != null
                      ? `★ ${k.ratingAvg.toFixed(1)}`
                      : "New to the neighborhood"}
                    {k.hygieneScore != null
                      ? ` · Hygiene ${k.hygieneScore}`
                      : ""}
                  </span>
                  <Icon name="arrow" width={18} height={18} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
