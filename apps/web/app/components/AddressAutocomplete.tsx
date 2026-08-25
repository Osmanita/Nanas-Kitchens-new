"use client";

/** Address picker for the seller portal (Story 1.3 AC1/AC4).
 *
 * Typing a free-text address and hoping the server can geocode it is what produced the
 * "We couldn't locate that address" dead end. Instead we query the same geocoder the API
 * uses (Nominatim) while the seller types and let them pick a real, resolvable place. The
 * chosen entry carries its own lat/lon, which the caller sends along — so the server skips
 * geocoding entirely (KitchensService.resolvePoint) and the failure path stops happening.
 *
 * Nominatim asks for at most 1 request/second, hence the debounce and the minimum length.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface AddressPick {
  /** Exactly what belongs in the address field — the canonical place, or, for an
   * approximate pick, the seller's own precise text (we only borrow the coordinates). */
  label: string;
  lat: number;
  lon: number;
  approximate: boolean;
}

interface Suggestion extends AddressPick {
  id: string;
  /** True when it came from a broadened query — the street/area, not the exact house. */
  approximate: boolean;
}

const MIN_CHARS = 4;
const DEBOUNCE_MS = 600;
/** Nominatim asks for ≤1 request/second; broadened retries wait this long between tries. */
const RETRY_GAP_MS = 1100;
const MAX_BROADENINGS = 3;

interface RawPlace {
  place_id: number | string;
  display_name: string;
  lat: string;
  lon: string;
  class?: string;
  addresstype?: string;
}

/** Area-level results only. A broadened query happily matches OTHER streets nearby
 * ("Dr, Powell, OH" returns Rochelle Drive), which would place the kitchen on a road the
 * seller never lives on. Towns and postcodes are the only safe approximation. */
const AREA_TYPES = new Set([
  "city", "town", "village", "hamlet", "suburb", "neighbourhood", "quarter",
  "municipality", "postcode", "county", "state", "administrative",
]);

function isArea(row: RawPlace): boolean {
  return (
    AREA_TYPES.has(row.addresstype ?? "") || row.class === "place" || row.class === "boundary"
  );
}

async function lookup(
  query: string,
  signal: AbortSignal,
  areaOnly = false,
): Promise<Omit<Suggestion, "approximate">[]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(query)}`,
    { headers: { accept: "application/json" }, signal },
  );
  const body = await res.json();
  const rows: RawPlace[] = Array.isArray(body) ? body : [];
  return rows
    .filter((row) => !areaOnly || isArea(row))
    .map((row) => ({
      id: String(row.place_id),
      label: row.display_name,
      lat: Number(row.lat),
      lon: Number(row.lon),
    }));
}

/** Progressively wider queries. Commas are the reliable signal — dropping the leading
 * component turns "3092 Azalea Dr, Powell, OH" into "Powell, OH". Without commas we fall
 * back to trailing word windows, which lands on the same town for a typed-out address. */
function broadenings(query: string): string[] {
  const parts = query.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return parts.slice(1).map((_, i) => parts.slice(i + 1).join(", ")).slice(0, MAX_BROADENINGS);
  }
  const tokens = query.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let take = Math.min(3, tokens.length - 1); take >= 2; take--) {
    out.push(tokens.slice(tokens.length - take).join(" "));
  }
  return out.slice(0, MAX_BROADENINGS);
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

export default function AddressAutocomplete({
  value,
  onChange,
  onPick,
  placeholder = "Start typing your street, then pick your address",
  required = false,
  id = "address-autocomplete",
}: {
  value: string;
  /** Free typing — the caller should clear any previously picked coordinates. */
  onChange: (value: string) => void;
  /** A real place was chosen; label is the canonical address, with its coordinates. */
  onPick: (pick: AddressPick) => void;
  placeholder?: string;
  required?: boolean;
  id?: string;
}) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [active, setActive] = useState(-1);

  const boxRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Set right after a pick so the resulting value change doesn't re-open the list.
  const skipRef = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    setActive(-1);
  }, []);

  // Debounced lookup. Every run cancels the previous request, so a fast typist only ever
  // has one in flight and late responses cannot overwrite newer ones.
  useEffect(() => {
    if (skipRef.current) {
      skipRef.current = false;
      return;
    }
    const query = value.trim();
    if (query.length < MIN_CHARS) {
      abortRef.current?.abort();
      setItems([]);
      setSearched(false);
      setLoading(false);
      close();
      return;
    }

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        let next: Suggestion[] = (await lookup(query, controller.signal)).map((r) => ({
          ...r,
          approximate: false,
        }));

        // OSM has patchy house-number coverage — plenty of real residential streets simply
        // aren't in it — so an exact miss is common and must not be a dead end. Widen to the
        // surrounding town, area-level results only.
        for (const wider of broadenings(query)) {
          if (next.length > 0) break;
          await sleep(RETRY_GAP_MS, controller.signal);
          next = (await lookup(wider, controller.signal, true)).map((r) => ({
            ...r,
            approximate: true,
          }));
        }

        setItems(next);
        setSearched(true);
        setActive(-1);
        setOpen(true);
      } catch (err) {
        // An aborted request is a newer keystroke, not a failure — leave the list alone.
        if ((err as Error)?.name !== "AbortError") {
          setItems([]);
          setSearched(true);
          setOpen(true);
        }
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [value, close]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Clicking anywhere else dismisses the list.
  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onDocPointerDown);
    return () => document.removeEventListener("mousedown", onDocPointerDown);
  }, [open, close]);

  function choose(item: Suggestion) {
    // An exact hit replaces the text with the canonical address. An approximate one must
    // NOT — the seller's house number is the real delivery address and only the map point
    // is being borrowed, so we leave their text untouched.
    const label = item.approximate ? value.trim() : item.label;
    if (!item.approximate) {
      // Only guard the effect when the value actually changes, or the flag would linger
      // and swallow the next keystroke's search.
      skipRef.current = true;
      onChange(item.label);
    }
    onPick({ label, lat: item.lat, lon: item.lon, approximate: item.approximate });
    setItems([]);
    close();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") return close();
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      // Only swallow Enter when a row is highlighted, so the form still submits otherwise.
      e.preventDefault();
      choose(items[active]);
    }
  }

  const listId = `${id}-listbox`;

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <input
        id={id}
        className="field"
        style={{ marginBottom: 6 }}
        required={required}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => items.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {loading && (
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--brand-muted)" }}>Looking up addresses…</p>
      )}

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Address suggestions"
          style={{
            position: "absolute",
            zIndex: 30,
            top: "100%",
            left: 0,
            right: 0,
            margin: 0,
            padding: 4,
            listStyle: "none",
            background: "#fff",
            border: "1px solid var(--brand-border)",
            borderRadius: 12,
            boxShadow: "0 12px 30px rgba(36, 40, 31, 0.14)",
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {items.some((it) => it.approximate) && (
            <li
              aria-hidden="true"
              style={{ padding: "8px 12px 6px", fontSize: 12.5, color: "var(--brand-muted)", lineHeight: 1.45 }}
            >
              We couldn&rsquo;t find that exact house number on the map. Pick the closest area below — your
              full address is still stored exactly as you typed it, encrypted.
            </li>
          )}
          {items.map((item, i) => (
            <li key={item.id} id={`${id}-opt-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1.4,
                  color: "var(--brand-ink)",
                  background: i === active ? "var(--brand-cream)" : "transparent",
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
          {items.length === 0 && searched && !loading && (
            <li
              role="option"
              aria-selected={false}
              aria-disabled="true"
              style={{ padding: "10px 12px", fontSize: 14, color: "var(--brand-muted)" }}
            >
              No matching address — try adding the city or postal code.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
