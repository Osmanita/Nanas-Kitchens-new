import { afterEach, describe, expect, it, vi } from "vitest";
import { isWithinReviewWindow, REVIEW_WINDOW_MONTHS } from "./reviewWindow";

/** Freezes the clock at a UTC instant so the month arithmetic is testable. */
function at(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("isWithinReviewWindow", () => {
  it("accepts an order placed today", () => {
    at("2026-08-24T12:00:00Z");
    expect(isWithinReviewWindow("2026-08-24T09:00:00Z")).toBe(true);
  });

  it("rejects an order older than the window", () => {
    at("2026-08-24T12:00:00Z");
    expect(isWithinReviewWindow("2025-12-01T09:00:00Z")).toBe(false);
  });

  // The bug: on 31 August, setUTCMonth(month - 6) asked for "31 February", which JS rolls
  // forward to 2/3 March. The cutoff moved days LATER than the true six-month mark, so the
  // form closed early — client-side only, while the server still accepted the review.
  it("does not overflow when today's day-of-month does not exist six months back", () => {
    at("2026-08-31T12:00:00Z");
    // 28 February 2026 is exactly the clamped six-month cutoff; anything at or after it is in.
    expect(isWithinReviewWindow("2026-02-28T12:00:00Z")).toBe(true);
    // The overflowed cutoff would have been 3 March, wrongly rejecting the whole of February.
    expect(isWithinReviewWindow("2026-03-01T00:00:00Z")).toBe(true);
    // Still genuinely outside the window.
    expect(isWithinReviewWindow("2026-02-27T12:00:00Z")).toBe(false);
  });

  it("clamps into a leap February too", () => {
    at("2028-08-31T12:00:00Z");
    expect(isWithinReviewWindow("2028-02-29T12:00:00Z")).toBe(true);
    expect(isWithinReviewWindow("2028-02-28T12:00:00Z")).toBe(false);
  });

  it("keeps the exact day when it exists in the target month", () => {
    at("2026-08-15T12:00:00Z");
    expect(isWithinReviewWindow("2026-02-15T12:00:00Z")).toBe(true);
    expect(isWithinReviewWindow("2026-02-14T12:00:00Z")).toBe(false);
  });

  it("mirrors the server's window length", () => {
    expect(REVIEW_WINDOW_MONTHS).toBe(6);
  });
});
