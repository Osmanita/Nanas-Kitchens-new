# Story 7.3: Admin Console — Inspectors, Visits & Score Disputes

**Epic:** 7 — Trust & Health Scoring    **Status:** Done (retrospective doc; implemented in apps/api-java)
**Traces:** FR20 (follow-up), NFR10

## Story
As platform staff, I want to provision inspectors, assign visits, and resolve sellers'
score disputes, so that the hygiene badge stays trustworthy without letting anyone edit
a submitted score directly.

## Acceptance Criteria
1. An admin invites inspectors (email + password), sees per-inspector assigned/scored
   counts, assigns visits (kitchen + inspector + datetime), and sees all visits.
2. A seller with a hygiene badge opens a dispute (reason 10–1000 chars) on their own
   kitchen; only one open dispute at a time (DISPUTE_ALREADY_OPEN).
3. The admin resolves a dispute as **dismissed** (score stands) or **annulled** (badge
   cleared — kitchen returns to "Not yet inspected" until re-inspection). The
   HygieneScore row itself is never edited.
4. The seller is notified of the outcome (FR22 inbox); resolutions carry an optional
   admin note and are audit-logged.

## Implementation (as built)
- Backend: `apps/api-java/.../admin/{AdminController,AdminService,ScoreDisputesController}.java`
  - Admin (ADMIN role): GET/POST `/admin/inspectors`, GET `/admin/inspections`,
    GET `/admin/kitchens`, GET `/admin/disputes?status=`, POST `/admin/disputes/{id}/resolve`.
  - Seller: POST `/kitchens/{kitchenId}/score-dispute` (own kitchen).
- Model: `ScoreDispute(id, kitchenId, openedById, reason, status open|dismissed|annulled,
  adminNote, resolvedAt)`; annul clears `Kitchen.hygieneScoreTotal/hygieneScoredAt`.
- Web: `apps/web/app/admin/page.tsx` (inspector provisioning, visit assignment +
  overview, dispute queue); `ScoreDisputeSection` in
  `apps/web/app/seller/kitchen/page.tsx`.

## Testing Requirements
- AuthZ: /admin/** admin-only; dispute open is owner-seller-only.
- Single-open-dispute guard; resolution enum validated (dismissed|annulled).
- Annul clears the badge but leaves the HygieneScore row intact.
