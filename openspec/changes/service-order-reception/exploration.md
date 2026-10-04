# Exploration: Service Order Reception

Round-2 step 2 (owner grill 2026-10-03): vehicle intake when a service order is opened — mileage, fuel or battery level by motor type, photos, customer ID document; printed sheet shows photos from page 2 and reserves a QR slot.

## Current state

- `orden_servicio` (`src/shared/db/schema.ts:469`): status, categoria, description, appointmentAt, completedAt, hallazgos, recomendaciones, observaciones, createdBy. `vehiculo.motor` (combustion/electrico/hibrido, nullable) shipped in step 1 and is in `PublicVehiculo`. Next migration: 0023.
- Create (`POST /api/service-orders`) and edit (PATCH) whitelist fields by name; every new field needs explicit handling in both. Customer and vehicle are immutable after create.
- Edit gate `edit-policy.ts` (D11): administrador edits `open` and `in_progress`; técnico only `in_progress`; `done`/`cancelled` closed. A técnico cannot PATCH an `open` order.
- `ServiceOrderForm.tsx` fetches vehicles only in create mode; edit mode needs the motor passed as a prop.
- Print page: header buttons are `print:hidden`, so the top-right is empty on paper — a QR slot there costs no page-1 height. The 4-column header has roughly 240px of slack before the signature moves to page 2; intake rows add about one row (print-preview check required). Photos go after the signature with `break-before-page`.

## Upload paths to copy

- `catalog-storage/r2.ts`: putObject/getObject/deleteObject. **Its `S3Client` does NOT set `requestChecksumCalculation`/`responseChecksumValidation: "WHEN_REQUIRED"`** — only `scripts/upload-backup.mjs` does. Add both and confirm one real PUT.
- `workshop-config/logo.ts` `validateCover`: magic-byte sniff (PNG/JPEG/WebP), 2MB cap, rejects SVG; routes pre-check Content-Length.
- Serving: same-origin authenticated proxy route (`Content-Disposition: inline`, `nosniff`, sandbox CSP, `Cache-Control: private`, ETag). Closest precedent: `api/template-config/cover-image/[templateId]/route.ts`. Cookie auth works for `<img>`.
- No `sharp` → compression is client-side. `retention.ts` touches only catalog PDFs, so photos are exempt.

## Customer ID

`cliente` has no ID document column. Add `documento_identidad text null`, trimmed, length cap ~30, NOT unique (family members share documents, as with phones), no format check (Panamá cédulas/RUC vary). Import writes only name/phone/email, so it never overwrites the new column.

## RBAC

Both roles hold `service-orders.read`/`write`. New photo routes need `ROUTE_GUARDS` entries. Photos need their own status gate (not `canEditOrderFields`) if técnicos must photograph `open` orders.

## Insecure context

`<input type="file" accept="image/*" capture="environment" multiple>` → `createImageBitmap(file)` (EXIF via default `imageOrientation: "from-image"`) → `<canvas>` capped at 1600px long edge → `toBlob("image/jpeg", 0.8)` → FormData POST. MDN shows no secure-context restriction on these, but verify at the LAN IP from a real phone. Photo id generated server-side; server re-sniffs bytes. ~300–600KB per photo; server cap ~3MB.

## Recommended data model

- `orden_servicio`: `kilometraje integer` (CHECK ≥ 0, sane max), `nivel_combustible smallint` (CHECK 0..4: E, 1/4, 1/2, 3/4, F), `bateria_pct smallint` (CHECK 0..100). All nullable.
- `orden_servicio_foto`: id, orden_id (cascade), r2_key, content_type, position, created_by (set null), created_at; index (orden_id, position); per-order cap. R2 key `service-orders/<ordenId>/<photoId>.jpg`.

## Suggested PRs (chained)

1. `cliente.documento_identidad` (~250)
2. Intake fields km/fuel/battery, motor-aware form, detail display (~350)
3. Photo backend: table, r2 checksum options, POST/GET/DELETE routes, guards, cap, e2e (~380)
4. Client compression + `OrderPhotos` uploader on the detail page (~300)
5. Print: intake rows, QR slot, photos from page 2, print-preview check (~250)

## Open questions for the owner

1. Photos at creation: create the order first and add photos on the detail page, or inside the "Nueva orden" dialog? **Answered 2026-10-04:** create first; after "Crear" the app navigates straight to the order's detail page, where a "Fotos de recepción" card takes the photos.
2. Who may add/delete photos (técnico on an `open` order? delete: admin or uploader only?) **Answered 2026-10-04:** add — any role with `service-orders.write` while the order is `open` or `in_progress`, never once `done`/`cancelled`; delete — administrador only, same statuses.
3. Hybrid records fuel and battery; unset motor shows both, optional — confirm. **Answered 2026-10-04:** combustion → fuel in quarters (E, 1/4, 1/2, 3/4, F); eléctrico → battery %; híbrido → both; motor unset → both, optional.
4. Is km required to open an order? **Answered 2026-10-04:** optional (a dead dashboard cannot be read; a forced "0" is worse than empty); the order detail shows a visible "Sin kilometraje" when missing.
5. Photo cap per order (~12)? **Answered 2026-10-04:** 12 per order; printed 4 per sheet from page 2.
6. Cédula/RUC: one free-text field; printed on page 1? **Answered 2026-10-04:** one free-text "Cédula / RUC" field on the customer, not unique, no format check; printed on page 1 beside the customer's name and phone.
7. QR slot ~24mm top-right of the printed header — confirm. **Answered 2026-10-04:** ~25mm square top-right of page 1, in the area of the print-hidden buttons; left blank (no box, no text) until the portal exists.

## Risks

- Print layout invisible to jsdom: print-preview verification; a photo-less order must stay one page.
- Real SQL (ordering, cap, CHECKs) needs e2e rows.
- R2 checksum options missing in the app adapter.
- Camera capture and compression must be verified from the LAN IP on a real phone.
