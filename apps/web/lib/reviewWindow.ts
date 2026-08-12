/** Story 6.1 (FR16) — buyers can only rate an order within this many months of placing it;
 * mirrors the cutoff enforced server-side in ReviewsService (REVIEW_WINDOW_MONTHS). */
export const REVIEW_WINDOW_MONTHS = 6;

export function isWithinReviewWindow(orderCreatedAt: string): boolean {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - REVIEW_WINDOW_MONTHS);
  return new Date(orderCreatedAt) >= cutoff;
}
