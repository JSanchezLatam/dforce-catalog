# Proposal: Service Order Reception

## Intent

Round-2 step 2 (owner grill 2026-10-03). When a vehicle is received, the workshop records no mileage, fuel or battery level, photos, or customer ID document, so the order and printed sheet cannot evidence the vehicle's condition at intake. Owner answers in `exploration.md` (2026-10-04) are final.

## Scope

### In Scope
- Customer "Cédula / RUC": one optional free-text field, trimmed, length-capped, not unique, no format check.
- Order intake: kilometraje (optional; detail shows "Sin kilometraje" when missing); fuel in quarters (E, 1/4, 1/2, 3/4, F) for combustión, battery % for eléctrico, both for híbrido, both optional when motor is unset.
- After "Crear", navigate to the new order's detail page.
- "Fotos de recepción" card on order detail: client-side compression to 1600px long-edge JPEG, upload to R2 through an authenticated same-origin proxy, max 12 per order. Add: any role with `service-orders.write` while `open`/`in_progress`. Delete: administrador only, same statuses. Never touched by retention.
- R2 client sets `requestChecksumCalculation`/`responseChecksumValidation: "WHEN_REQUIRED"`.
- Printed sheet: Cédula/RUC beside name and phone, intake rows on page 1; blank ~25mm square QR slot top-right (no box, no text); photos 4 per sheet from page 2; signature stays on page 1; a photo-less order stays one page.

### Out of Scope
- The QR code and the customer portal (step 4).
- Technician/`jefe_taller` changes (step 3).
- Importing Cédula/RUC; photo editing/annotation; damage diagram.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `customer-management`: Cédula / RUC field and validation.
- `service-orders`: intake fields by motor type, post-create navigation, reception photos (cap, add/delete rules, serving), Printable Work Order additions.

## Approach

Per `exploration.md`: migration 0023+ adds `cliente.documento_identidad`, `orden_servicio.kilometraje`/`nivel_combustible` (0..4)/`bateria_pct` (0..100) with CHECKs, and `orden_servicio_foto` (cascade on order, `(orden_id, position)` index). Photo status gate is its own rule, not `canEditOrderFields`. Server re-sniffs bytes (copy `validateCover`), ~3MB cap, server-generated id, key `service-orders/<ordenId>/<photoId>.jpg`. Compression uses `createImageBitmap` + canvas (no secure-context API).

Five chained PRs: (1) Cédula/RUC; (2) intake fields, motor-aware form, detail, navigation; (3) photo table, R2 options, routes, guards, cap, e2e; (4) compression + uploader card; (5) print.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/shared/db/schema.ts`, migrations | Modified/New | Columns, `orden_servicio_foto` |
| `src/modules/customers/` | Modified | Cédula/RUC |
| `src/modules/service-orders/`, `ServiceOrderForm.tsx`, `/api/service-orders` | Modified | Intake fields, photo gate |
| `src/modules/catalog-storage/r2.ts` | Modified | Checksum options |
| New photo routes, `route-guards` | New/Modified | Upload/serve/delete |
| Order detail and print pages | Modified | Display, photos, QR slot |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Print layout pushes signature to page 2 | Med | Print-preview check |
| Real SQL (cap, ordering, CHECKs) unseen | High | e2e rows |
| R2 PUT fails without checksum options | Med | Confirm one real PUT |
| Camera/compression fails off localhost | Med | Verify on a phone at the LAN IP |

## Rollback Plan

Revert PRs in reverse order. Migrations are additive; down migrations drop columns/table (losing intake data and photo rows); R2 objects under `service-orders/` can be deleted by prefix.

## Dependencies

- Owner-approved mockup (form, photo card, print) before apply — APPROVED as-is by the owner 2026-10-04 (`mockup/index.html`).

## Success Criteria

- [ ] Intake fields follow motor type; missing km shows "Sin kilometraje".
- [ ] 13th photo refused; técnico cannot delete; no add/delete on `done`/`cancelled`.
- [ ] Photos load at the LAN IP from a phone; print keeps signature on page 1, photos 4 per page from page 2.

## Proposal question round

All seven owner questions answered 2026-10-04 (`exploration.md`); no open product questions. Mockup approved 2026-10-04.
