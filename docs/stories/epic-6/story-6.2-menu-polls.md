# Story 6.2: Seller Menu Polls

**Epic:** 6 — Community & Trust    **Status:** Done (retrospective doc; implemented in apps/api-java)
**Traces:** FR17

## Story
As a seller, I want to poll my buyers on candidate upcoming menu items, so that I cook
what my community actually wants and waste fewer portions.

## Acceptance Criteria
1. A seller creates a poll (question + 2–6 option labels, optional close date) on their
   own kitchen only.
2. One vote per buyer per poll (`@@unique([pollId, buyerId])`) — re-voting returns
   ALREADY_VOTED; after voting the buyer sees live tallies with their choice marked.
3. Sellers and signed-out visitors see results but cannot vote; buyers who haven't voted
   see clickable options.
4. The seller sees live tallies and can close a poll early.

## Implementation (as built)
- Backend: `apps/api-java/.../polls/{PollsController,PollsService}.java`
  - POST `/kitchens/{kitchenId}/polls` (SELLER, own kitchen), GET (public — carries
    `myVote` when a buyer token is attached), POST `/polls/{id}/vote` (BUYER),
    POST `/polls/{id}/close` (owner).
- Model: `Poll(id, kitchenId, question, options[], closesAt)` + `PollVote` with the
  one-vote uniqueness constraint.
- Web: `PollsManager` (create/close/tallies) in `apps/web/app/seller/menu/page.tsx`;
  `PollCard` (vote + results bars) on `apps/web/app/kitchens/[id]/page.tsx`.

## Testing Requirements
- One-vote rule: second vote → ALREADY_VOTED (409/400), tallies unchanged.
- AuthZ: seller can't vote; buyer can't create/close; cross-kitchen create → 403.
- Closed poll rejects new votes.
