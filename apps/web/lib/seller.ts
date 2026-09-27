import { apiFetch } from "./api";
import type { MenuPoll } from "./polls";

export interface SellerKitchen {
  id: string;
  name: string;
  photos: string[];
  complianceAttestedAt: string | null;
  ratingAvg: number | null;
  ratingCount: number;
}

export interface PortalOrder {
  id: string;
  status: string;
  readySlot: string;
  fulfillment: string;
  totalCents: number;
  buyerEmail: string;
  itemsSummary: string | null;
  items: { name: string; qty: number; photo: string | null }[];
}

export interface PortalMenu {
  id: string;
  date: string;
  status: string;
  readyWindows: { start: string; end: string }[];
  items: {
    id: string;
    portionsRemaining: number;
    portionsTotal: number;
    dish: { name: string; photo: string | null; priceCents: number };
  }[];
}

export interface PortalEarnings {
  paid: { orders: number; netCents: number };
  upcoming: { orders: number; netCents: number };
}

export interface SellerSnapshot {
  orders?: PortalOrder[];
  menus?: PortalMenu[];
  earnings?: PortalEarnings;
  polls?: MenuPoll[];
  failed: string[];
}

export const paidStatuses = new Set([
  "confirmed",
  "accepted",
  "preparing",
  "ready",
  "completed",
]);
export const workingStatuses = new Set([
  "confirmed",
  "accepted",
  "preparing",
  "ready",
]);

export async function sellerJson<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await apiFetch(path, { signal });
  if (!response.ok) throw new Error("Could not load kitchen data");
  return response.json();
}

/** A failed section must remain unavailable rather than silently report zero sales. */
export async function loadSellerSnapshot(
  kitchenId: string,
  date: string,
  signal?: AbortSignal,
): Promise<SellerSnapshot> {
  const results = await Promise.allSettled([
    sellerJson<PortalOrder[]>(`/kitchens/${kitchenId}/orders`, signal),
    sellerJson<PortalMenu[]>(
      `/kitchens/${kitchenId}/menu-days?date=${date}`,
      signal,
    ),
    sellerJson<PortalEarnings>(`/kitchens/${kitchenId}/earnings`, signal),
    sellerJson<MenuPoll[]>("/polls/mine", signal),
  ]);
  const [orders, menus, earnings, polls] = results;
  return {
    orders: orders.status === "fulfilled" ? orders.value : undefined,
    menus: menus.status === "fulfilled" ? menus.value : undefined,
    earnings: earnings.status === "fulfilled" ? earnings.value : undefined,
    polls: polls.status === "fulfilled" ? polls.value : undefined,
    failed: results.flatMap((r, i) =>
      r.status === "rejected"
        ? [["orders", "menu", "earnings", "polls"][i]]
        : [],
    ),
  };
}

export function serviceDateLabel(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

export function validServiceDate(value: string | null): value is string {
  return (
    !!value &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
