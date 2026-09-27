"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { PickedLocation } from "../../lib/location";
import styles from "./DeliveryMap.module.css";

const LeafletMap = dynamic(() => import("./LeafletMap"), { ssr: false });
type Point = { lat: number; lng: number };
const lookups = new Map<string, Promise<Point | null>>();

function validPoint(point: Point) {
  return Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 &&
    Number.isFinite(point.lng) && Math.abs(point.lng) <= 180;
}

function locate(address: string): Promise<Point | null> {
  const cached = lookups.get(address);
  if (cached) return cached;
  // Share the lookup across Strict Mode mounts. Never trim a delivery address to an
  // unrelated locality just to obtain a pin; an unresolved address needs a new selection.
  const request = fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) },
  ).then(async (response) => {
    if (!response.ok) return null;
    const results = await response.json();
    if (!results[0]) return null;
    const point = { lat: Number(results[0].lat), lng: Number(results[0].lon) };
    return validPoint(point) ? point : null;
  }).catch(() => null);
  if (lookups.size >= 100) lookups.clear();
  lookups.set(address, request);
  void request.then((point) => { if (!point) lookups.delete(address); });
  return request;
}

export default function DeliveryMap({ address, location }: {
  address: string;
  /** Only use a saved pin if it belongs to this exact delivery address. */
  location?: PickedLocation | null;
}) {
  const selected = location?.label === address && validPoint(location) ? location : null;
  const [resolved, setResolved] = useState<{ address: string; point: Point | null } | null>(null);
  const [tiles, setTiles] = useState<"loading" | "ready" | "error">("loading");
  const point = selected ?? (resolved?.address === address ? resolved.point : null);
  const missing = !selected && resolved?.address === address && !resolved.point;

  useEffect(() => {
    setTiles("loading");
    if (selected) return;
    let active = true;
    void locate(address).then((point) => {
      if (active) setResolved({ address, point });
    });
    return () => { active = false; };
  }, [address, selected]);

  useEffect(() => {
    if (!point || tiles !== "loading") return;
    const timeout = setTimeout(() => setTiles("error"), 15_000);
    return () => clearTimeout(timeout);
  }, [point, tiles]);

  const mapUrl = point
    ? `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lng}#map=15/${point.lat}/${point.lng}`
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`;

  return (
    <div className={styles.preview}>
      <div className={styles.map} aria-label={`Delivery map for ${address}`}>
        {point && (
          <LeafletMap center={point} marker={point} zoom={15} restrictToUS={false}
            onTilesLoaded={() => setTiles("ready")} onTilesError={() => setTiles("error")} />
        )}
        {(missing || tiles !== "ready") && (
          <div className={styles.status} role="status">
            {missing ? "Address not found on the map. Choose a delivery pin with Change address."
              : tiles === "error" ? "Map tiles could not load. You can still open the location below."
                : "Loading delivery map…"}
          </div>
        )}
      </div>
      <div className={styles.details}>
        <div><span>Delivery location</span><strong>{address}</strong></div>
        <a href={mapUrl} target="_blank" rel="noreferrer">Open map</a>
      </div>
    </div>
  );
}
