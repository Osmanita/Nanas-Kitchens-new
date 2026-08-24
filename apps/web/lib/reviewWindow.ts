/** Story 6.1 (FR16) — buyers can only rate an order within this many months of placing it;
 * mirrors the cutoff enforced server-side in ReviewsService (REVIEW_WINDOW_MONTHS). */
export const REVIEW_WINDOW_MONTHS = 6;

export function isWithinReviewWindow(orderCreatedAt: string): boolean {
  const now = new Date();
  // setUTCMonth() alone overflows: on 31 August, "31 February" rolls forward into March and
  // the cutoff lands days later than it should, closing the form before the server does.
  // Clamp to the last day of the target month, which is what Java's minusMonths() —
  // ReviewsService, the authority here — already does.
  const day = now.getUTCDate();
  const cutoff = new Date(now.getTime());
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - REVIEW_WINDOW_MONTHS);
  const daysInCutoffMonth = new Date(
    Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0),
  ).getUTCDate();
  cutoff.setUTCDate(Math.min(day, daysInCutoffMonth));
  return new Date(orderCreatedAt) >= cutoff;
}
