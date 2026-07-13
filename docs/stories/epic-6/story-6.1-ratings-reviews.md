# Story 6.1: Post-Completion Ratings & Reviews

**Epic:** 6 — Community & Trust    **Status:** Done (retrospective doc; implemented in apps/api-java)
**Traces:** FR16

## Story
As a buyer, I want to rate and review a kitchen after my order is completed, so that
other buyers can judge kitchens by real, verified experiences.

## Acceptance Criteria
1. Given a COMPLETED order, When the buyer opens the order page, Then a 1–5 star form
   with an optional comment (≤1000 chars) is shown; non-completed orders never offer it.
2. One review per order (orderId UNIQUE) — a second submission returns ALREADY_REVIEWED.
3. Given submission, Then Kitchen.ratingAvg/ratingCount are recomputed (denormalized)
   and the public kitchen profile shows the aggregate plus individual reviews.
4. Reviews are anonymous on the public profile ("Verified buyer" + date); the buyer's
   identity is never displayed (NFR5 spirit).

## Implementation (as built)
- Backend: `apps/api-java/.../reviews/{ReviewsController,ReviewsService}.java`
  - POST `/kitchens/{kitchenId}/reviews` (BUYER role) — validates the order belongs to
    the buyer, is for this kitchen, and is completed.
  - GET `/kitchens/{kitchenId}/reviews` (public), GET `/orders/{orderId}/review` (own).
- Model: `Review(id, orderId UNIQUE, kitchenId, buyerId, rating, comment)`;
  `Kitchen.ratingAvg/ratingCount` recomputed on insert (Prisma schema, apps/api/prisma).
- Web: `ReviewCard` in `apps/web/app/orders/[id]/page.tsx` (star picker + comment);
  read-only list + aggregate on `apps/web/app/kitchens/[id]/page.tsx`.
- Buyer order history (`/orders`) flags completed-but-unreviewed orders ("Rate this order").

## Testing Requirements
- AuthZ: only the order's buyer can review; sellers/other buyers → 403.
- Uniqueness: second POST for the same order → ALREADY_REVIEWED.
- Aggregate correctness: ratingAvg/ratingCount after N inserts.
