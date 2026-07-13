# Story 6.3: Dish Requests

**Epic:** 6 — Community & Trust    **Status:** Done (retrospective doc; implemented in apps/api-java)
**Traces:** FR18

## Story
As a buyer, I want to ask a kitchen for a dish or cuisine I'm craving, so that sellers
learn real demand and I get notified if they take it on.

## Acceptance Criteria
1. A signed-in buyer sends a free-text request (≤500 chars) from the kitchen profile;
   signed-out visitors are prompted to log in.
2. The seller sees an inbox of open requests for their kitchen and accepts (optional
   note) or declines each one.
3. On accept/decline the requester is notified in-app (FR22 inbox) with the seller's
   note when present; status becomes accepted | declined.
4. A buyer's duplicate open request to the same kitchen is rejected (REQUEST_ALREADY_OPEN).

## Implementation (as built)
- Backend: `apps/api-java/.../community/{DishRequestsController,DishRequestsService}.java`
  - POST `/kitchens/{kitchenId}/dish-requests` (BUYER), GET (SELLER, own kitchen),
    POST `/dish-requests/{id}/respond` (SELLER: accept/decline + note).
- Model: `DishRequest(id, kitchenId, buyerId, text, status open|accepted|declined,
  sellerNote)`.
- Web: "Request a dish" prompt on `apps/web/app/kitchens/[id]/page.tsx`; seller inbox
  section in `apps/web/app/seller/menu/page.tsx`; notification deep-links via the
  header bell (`Header.tsx`).

## Testing Requirements
- AuthZ: only the kitchen's owner lists/responds; buyers only create.
- Duplicate-open guard per buyer+kitchen.
- Notification row written for the requester on respond.
