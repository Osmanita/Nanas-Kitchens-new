# Story 7.1: Health & Permit Documents

**Epic:** 7 — Trust & Health Scoring    **Status:** Done (retrospective doc; implemented in apps/api-java)
**Traces:** FR19, NFR5

## Story
As a seller, I want to upload my health permits and inspection paperwork, so that buyers
can verify my kitchen's legitimacy before ordering.

## Acceptance Criteria
1. A seller uploads PDF or image documents (≤5 MB) to their own kitchen; unsupported
   types → UNSUPPORTED_DOCUMENT_TYPE, oversize → DOCUMENT_TOO_LARGE.
2. The document list (display filename + upload date, newest first) is public on the
   kitchen profile — recency is the trust signal.
3. The seller can remove a document; every upload writes an AuditLog entry.
4. Stored files keep server-generated UUID names; the display filename is sanitized
   (no CR/LF/quotes/angle brackets).

## Implementation (as built)
- Backend: `apps/api-java/.../kitchens/HealthReportsController.java`
  - POST/GET/DELETE `/kitchens/{kitchenId}/health-reports[/{reportId}]`; GET is public,
    mutations require the owning SELLER. Reuses `PhotoStorage` (local disk now, S3 later).
- Model: `HealthReport(id, kitchenId, fileUrl, filename, uploadedAt)`.
- Web: `HealthReportsSection` (upload/list/remove) in
  `apps/web/app/seller/kitchen/page.tsx`; public list on
  `apps/web/app/kitchens/[id]/page.tsx`.

## Testing Requirements
- AuthZ: non-owner seller upload/delete → 403; public GET works signed-out.
- Type/size validation; filename sanitization.
- AuditLog row per upload.
