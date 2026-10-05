# Verify Report: Service Order Reception

**Verdict:** pass_with_warnings — 0 critical, 4 warnings, 2 suggestions.
**Candidate:** main @ 0ba9284 (PRs #159–#163, #165, and #164).

## Evidence

- `npx tsc --noEmit`: exit 0.
- `npm test`: exit 0, 152 files, 2236 tests.
- Tasks 1.1–5.6 ticked; 6.1 and 6.2 belong to archive.
- Every scenario in both delta specs has a covering test or recorded runtime evidence.

## Coverage (paths under `src/`)

| Area | Covering tests |
|---|---|
| Cédula / RUC | `modules/customers/validation.test.ts`, `modules/customers/service.test.ts`, `e2e/customer-documento.e2e.test.ts`, `modules/customer-import/job.test.ts` |
| Intake fields | `modules/service-orders/intake.test.ts`, `ServiceOrderForm.test.tsx`, `e2e/order-intake.e2e.test.ts` |
| Navigate after create | `modules/service-orders/ServiceOrderFormTrigger.test.tsx` |
| Photos (service) | `modules/service-orders/photos.test.ts`, `e2e/order-photos.e2e.test.ts` (13 concurrent adds → 12 rows) |
| Photos (routes, policy) | `app/api/service-orders/[id]/photos/route.test.ts`, `[photoId]/route.test.ts`, `modules/auth/route-guards.test.ts`, `policy.test.ts`, `edit-policy.test.ts` |
| Uploader card | `modules/service-orders/OrderPhotos.test.tsx`, `app/(app)/service-orders/[id]/page.test.tsx` |
| Print | `app/(app)/service-orders/[id]/print/page.test.tsx`, `modules/service-orders/PrintButton.test.tsx` |
| R2 options | `modules/catalog-storage/r2.test.ts` |

## Runtime evidence (orchestrator and owner, 2026-10-04/05)

- LAN browser checks as administrador and técnico: cédula trimmed; intake inputs per motor, fuel segments 44px, create lands on detail; uploader compresses 4032×3024 to 1600px (~180 KB), técnico has no delete, admin delete 44×44; order detail at 390px has no overflow; console clean.
- curl at the LAN IP: técnico upload 201, non-JPEG 400, 4 MB 413, unauthenticated 401, técnico DELETE 403, admin DELETE 200 then 404.
- Owner's real iPhone over HTTP: camera and gallery offered, real photo uploaded.
- Real R2 put/get/delete with `WHEN_REQUIRED`, plus an existing catalog PDF download.
- Print preview (PDF, dark theme): no photos = 1 page; 9 photos = 4 pages, signature on page 1, light sheet, blank QR slot.

## Warnings

1. Spec said the detail shows `85000`; code renders "85.000 km". Spec corrected before archive.
2. `design.md` said photo height 120mm; code uses 105mm. Corrected before archive.
3. `design.md` left dropping `capture` open; closed with the owner's iPhone confirmation.
4. Retention exemption is proven only by e2e; "4 per sheet" and "exactly 1 page" are proven only by the print preview (jsdom has no pagination).

## Suggestions

- 6.1: merge delta specs as MODIFIED in place, then check for duplicate titles.
- 6.2: follow-ups stay out of scope.
