import { apiFetch } from "./api";

export interface MenuPoll {
  id: string;
  kitchenId: string;
  kitchenName: string;
  question: string;
  options: string[];
  prices: number[];
  serviceDate: string;
  timeZone: string;
  readyTimes: string[];
  minimumPortions: number;
  capacity: number;
  tallies: number[];
  portions: number[];
  totalVotes: number;
  closesAt: string;
  closed: boolean;
  finalized: boolean;
  cookingOptions: number[];
  myVote: number | null;
  preorder: null | {
    qty: number;
    readyTime: string;
    status:
      | "awaiting_result"
      | "ready_for_payment"
      | "not_cooking"
      | "cancelled"
      | "ordered"
      | "expired";
    orderId: string | null;
    totalCents: number;
  };
}

export function kitchenDay(zone: string, offset = 0, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((p) => p.type === type)!.value;
  const date = new Date(
    `${value("year")}-${value("month")}-${value("day")}T12:00:00Z`,
  );
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function pickupDay(day: string, zone: string, now = new Date()) {
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${day === kitchenDay(zone, 1, now) ? "Tomorrow · " : day === kitchenDay(zone, 0, now) ? "Today · " : ""}${label}`;
}

export function qualifyingOptions(poll: MenuPoll) {
  const maximum = Math.max(0, ...poll.tallies);
  return poll.options
    .map((_, i) => i)
    .filter(
      (i) =>
        poll.tallies[i] > 0 &&
        (poll.tallies[i] === maximum ||
          poll.portions[i] >= poll.minimumPortions),
    );
}

const errors: Record<string, string> = {
  OUTSIDE_POLL_AREA:
    "This kitchen is outside your 10-mile neighborhood. Choose a closer kitchen.",
  LOCATION_REQUIRED: "Choose your location first to find nearby kitchens.",
  POLL_CLOSED: "Voting has closed. Refresh to see the cook’s decision.",
  POLL_PORTIONS_FULL:
    "Those portions were just reserved. Refresh and choose another dish or fewer portions.",
  ALREADY_VOTED:
    "You have already voted in this poll. Find your reservation under My pre-orders.",
  MENU_DAY_EXISTS:
    "You already have a menu for that day. Open My menu to review it; a poll needs a day without an existing menu.",
  POLL_MUST_BE_FOR_TOMORROW:
    "Choose tomorrow’s date in your kitchen’s time zone.",
  INVALID_VOTING_DEADLINE:
    "Voting must close in the future and before the first pickup time.",
  PUBLISH_REQUIRES_ATTESTATION:
    "Complete your kitchen’s compliance declaration in My menu first.",
  PREORDER_NOT_READY:
    "The cook hasn’t confirmed this dish yet. No payment is needed now.",
  PREORDER_EXPIRED:
    "The pickup time has passed. This pre-order can no longer be paid.",
  PICKUP_TIME_PASSED:
    "The first pickup time has passed. This menu can no longer be finalized.",
  PREORDER_NOT_CANCELLABLE:
    "This reservation has already been updated. Refresh to see its latest status.",
  WINDOWS_OVERLAP: "Leave at least five minutes between pickup times.",
  INVALID_PICKUP_TIMES:
    "Choose pickup times between 00:00 and 23:54, at least five minutes apart.",
};

export async function pollRequest<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    ...(body !== undefined
      ? { method: "POST", body: JSON.stringify(body) }
      : {}),
    signal: AbortSignal.timeout(25000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      errors[data.message] ??
        (res.status === 401
          ? "Please log in again to continue."
          : "We couldn’t save that change. Refresh and try again."),
    );
  return data as T;
}
