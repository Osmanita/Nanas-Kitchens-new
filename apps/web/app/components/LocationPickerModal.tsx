"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { PickedLocation } from "../../lib/location";

const LeafletMap = dynamic(() => import("./LeafletMap"), { ssr: false });

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

const DEFAULT_CENTER = { lat: 39.8283, lng: -98.5795 }; // continental US, low zoom
const DEFAULT_ZOOM = 4;
const PICKED_ZOOM = 15;

async function reverseGeocode(lat: number, lng: number, restrictToUS: boolean): Promise<string> {
  try {
    const cc = restrictToUS ? "&countrycodes=us" : "";
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}${cc}`,
      { headers: { accept: "application/json" } },
    );
    const data = await res.json();
    return data?.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

interface Props {
  open: boolean;
  /** Omitted on the very first (forced) prompt — there's nothing to go back to yet. */
  onClose?: () => void;
  onConfirm: (loc: PickedLocation) => void;
  /** Home's "browse near me" picker stays US-only (default); the chat order flow's
   * delivery-address picker needs to accept any address, so it opts out. */
  restrictToUS?: boolean;
}

export default function LocationPickerModal({ open, onClose, onConfirm, restrictToUS = true }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    // Reset per-open so a previous session's search doesn't linger.
    setQuery("");
    setResults([]);
    setPicked(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const cc = restrictToUS ? "&countrycodes=us" : "";
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=5${cc}&q=${encodeURIComponent(query)}`,
          { headers: { accept: "application/json" } },
        );
        const data = (await res.json()) as NominatimResult[];
        setResults(Array.isArray(data) ? data : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, restrictToUS]);

  function pickResult(r: NominatimResult) {
    setPicked({ lat: +r.lat, lng: +r.lon, label: r.display_name });
    setResults([]);
    setQuery(r.display_name);
  }

  async function pickFromMap(pos: { lat: number; lng: number }) {
    setError(null);
    const label = await reverseGeocode(pos.lat, pos.lng, restrictToUS);
    setPicked({ ...pos, label });
    setQuery(label);
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError("Bu tarayıcı konum servislerini desteklemiyor. Adres girerek devam edebilirsin.");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const label = await reverseGeocode(latitude, longitude, restrictToUS);
        setPicked({ lat: latitude, lng: longitude, label });
        setQuery(label);
        setLocating(false);
      },
      () => {
        setError("Konum izni alınamadı. Haritadan seç ya da adres yaz.");
        setLocating(false);
      },
      { timeout: 8000 },
    );
  }

  if (!open) return null;

  const center = picked ?? DEFAULT_CENTER;
  const zoom = picked ? PICKED_ZOOM : DEFAULT_ZOOM;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Konum seç"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 30, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className="card"
        style={{
          width: "min(560px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 24,
          background: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 20, color: "var(--brand-green)" }}>📍 Konumunu seç</h2>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Kapat"
              style={{ border: "none", background: "transparent", fontSize: 20, cursor: "pointer" }}
            >
              ✕
            </button>
          )}
        </div>
        <p style={{ margin: "4px 0 16px", color: "var(--brand-muted)", fontSize: 14 }}>
          Haritadan bir nokta seç, adresini yaz ya da konumunu paylaş.
          {restrictToUS && " (Şimdilik yalnızca ABD adresleri destekleniyor.)"}
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              restrictToUS ? "ABD adresi, sokak, şehir veya posta kodu yaz…" : "Adres, sokak, şehir veya posta kodu yaz…"
            }
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--brand-border)",
              fontSize: 14,
            }}
          />
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            style={{
              whiteSpace: "nowrap",
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid var(--brand-border)",
              background: "#fff",
              cursor: locating ? "default" : "pointer",
              fontSize: 14,
            }}
          >
            {locating ? "Bulunuyor…" : "📡 Konumumu kullan"}
          </button>
        </div>

        {searching && (
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--brand-muted)" }}>Aranıyor…</p>
        )}
        {results.length > 0 && (
          <ul
            style={{
              listStyle: "none",
              margin: "0 0 12px",
              padding: 0,
              border: "1px solid var(--brand-border)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => pickResult(r)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    border: "none",
                    background: i % 2 ? "#fafafa" : "#fff",
                    cursor: "pointer",
                    fontSize: 13.5,
                  }}
                >
                  {r.display_name}
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="form-error" role="alert" style={{ fontSize: 13.5 }}>
            {error}
          </p>
        )}

        <div
          style={{
            height: 280,
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid var(--brand-border)",
            marginBottom: 4,
          }}
        >
          <LeafletMap
            center={center}
            zoom={zoom}
            marker={picked}
            restrictToUS={restrictToUS}
            onPick={(pos) => {
              void pickFromMap(pos);
            }}
          />
        </div>
        <p style={{ margin: "6px 0 16px", fontSize: 12, color: "var(--brand-muted)" }}>
          Haritaya tıkla veya pini sürükle — konum otomatik adrese çevrilir.
        </p>

        {picked && (
          <p style={{ margin: "0 0 14px", fontSize: 13.5 }}>
            Seçilen: <strong>{picked.label}</strong>
          </p>
        )}

        <button
          type="button"
          disabled={!picked}
          onClick={() => picked && onConfirm(picked)}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 8,
            border: "none",
            background: picked ? "var(--brand-orange)" : "var(--brand-border)",
            color: "#fff",
            fontWeight: 700,
            fontSize: 15,
            cursor: picked ? "pointer" : "not-allowed",
          }}
        >
          Konumu onayla
        </button>
      </div>
    </div>
  );
}
