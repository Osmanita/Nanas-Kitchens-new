/** Buyer's chosen browse location — picked via the map/address modal on Home. Persisted
 * across visits like the cart; there is no server session for anonymous browsing. */

export interface PickedLocation {
  lat: number;
  lng: number;
  label: string;
}

const KEY = "location";
const EVENT = "location-changed";

export function getLocation(): PickedLocation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PickedLocation) : null;
  } catch {
    return null;
  }
}

export function saveLocation(loc: PickedLocation) {
  localStorage.setItem(KEY, JSON.stringify(loc));
  window.dispatchEvent(new Event(EVENT));
}

export function clearLocation() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
}

/** Subscribes to location changes (this tab + other tabs); returns an unsubscribe fn. */
export function subscribeLocation(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
