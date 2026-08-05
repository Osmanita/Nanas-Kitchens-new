"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import L from "leaflet";

// Default marker images don't resolve through the Next.js bundler; point them at the
// CDN copy that ships with the same Leaflet version instead of wiring up asset loaders.
const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Continental US — picker is scoped to US addresses only, so panning/zooming can't
// leave the country.
const US_BOUNDS = L.latLngBounds([24.396308, -125.0], [49.384358, -66.93457]);

interface Props {
  center: { lat: number; lng: number };
  zoom: number;
  marker: { lat: number; lng: number } | null;
  onPick: (pos: { lat: number; lng: number }) => void;
  /** Default true (Home's "browse near me" picker). The chat delivery-address picker sets
   * this false — a buyer's real address isn't always in the US. */
  restrictToUS?: boolean;
}

export default function LeafletMap({ center, zoom, marker, onPick, restrictToUS = true }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markerInstance = useRef<L.Marker | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    const map = L.map(mapRef.current, {
      ...(restrictToUS ? { maxBounds: US_BOUNDS, maxBoundsViscosity: 1.0 } : {}),
      minZoom: 2,
    }).setView([center.lat, center.lng], zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
      ...(restrictToUS ? { bounds: US_BOUNDS } : {}),
    }).addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (restrictToUS && !US_BOUNDS.contains(e.latlng)) return;
      onPickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    mapInstance.current = map;
    return () => {
      map.remove();
      mapInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recenter when the caller moves to a new point (search result / "use my location").
  useEffect(() => {
    mapInstance.current?.setView([center.lat, center.lng], zoom);
  }, [center.lat, center.lng, zoom]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    if (!marker) {
      markerInstance.current?.remove();
      markerInstance.current = null;
      return;
    }
    if (markerInstance.current) {
      markerInstance.current.setLatLng([marker.lat, marker.lng]);
    } else {
      markerInstance.current = L.marker([marker.lat, marker.lng], {
        icon: markerIcon,
        draggable: true,
      })
        .addTo(map)
        .on("dragend", (e) => {
          const marker = e.target as L.Marker;
          const pos = marker.getLatLng();
          if (restrictToUS && !US_BOUNDS.contains(pos)) {
            marker.setLatLng(US_BOUNDS.getCenter());
            return;
          }
          onPickRef.current({ lat: pos.lat, lng: pos.lng });
        });
    }
  }, [marker]);

  return <div ref={mapRef} style={{ width: "100%", height: "100%" }} />;
}
