# Tasks: Service Order Reception

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2,100 total, estimated at tests = ~55% of lines (production lines / 0.45): PR1 ~300, PR2 ~480, PR3 ~560, PR4 ~400, PR5 ~330; migration SQL, snapshots and `mockup/` excluded |
| 400-line budget risk | High (PR2 and PR3 exceed 400 by the 55% ratio; the design's per-PR numbers assumed fewer tests) |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR2 → PR3a → PR3b → PR4 → PR5, each based on the previous branch. PR2 may split 2a server (`intake.ts`, routes, service, e2e) / 2b UI (form, trigger, detail). PR3 is already split: 3a table + R2 + service + policy + e2e, 3b routes + guards |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No (resolved 2026-10-04; owner accepted size:exception for every PR over 400 lines, mostly tests)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

RDD review note: the planning commit contains `mockup/` PNG and PDF, which overflow the lens budget. Every review MUST run `gentle-ai review status ... --next-transition` with `--base-ref <planning commit> --committed-only`.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Cédula / RUC on customer | PR 1 (base: main) | `npx vitest run src/modules/customers` | e2e on throwaway `dforce_e2e`; LAN-IP browser check | Revert PR 1; 0023 is additive |
| 2 | Intake fields, motor-aware form, detail, navigate after create | PR 2 (base: PR 1 branch) | `npx vitest run src/modules/service-orders src/app/api/service-orders "src/app/(app)/service-orders"` | e2e CHECKs on `dforce_e2e`; LAN-IP browser check | Revert PR 2; 0024 additive |
| 3a | Photo table, R2 checksum options, `photos.ts`, gate, policy | PR 3a (base: PR 2 branch) | `npx vitest run src/modules/service-orders src/modules/auth src/modules/catalog-storage` | e2e on `dforce_e2e`; one real R2 PUT + catalog PDF download | Revert PR 3a; 0025 additive, objects deletable by prefix |
| 3b | Photo routes and `ROUTE_GUARDS` | PR 3b (base: PR 3a branch) | `npx vitest run src/app/api/service-orders` | curl at LAN IP as both roles | Revert PR 3b; service stays unused |
| 4 | `compress-photo.ts` and `OrderPhotos` card | PR 4 (base: PR 3b branch) | `npx vitest run src/modules/service-orders "src/app/(app)/service-orders"` | Real phone over HTTP; LAN-IP browser check | Revert PR 4; routes remain |
| 5 | Print: Cédula/RUC, intake rows, QR slot, photo pages, print wait | PR 5 (base: PR 4 branch) | `npx vitest run "src/app/(app)/service-orders"` | Print PREVIEW at LAN IP | Revert PR 5; screen detail unaffected |

Rule for every task pair: RED test, confirm red BY NAME, GREEN, then mutation-verify (revert the fix, the named test goes red). Fixtures must match the wire. Migrations come from `drizzle-kit generate --name <n>`, never hand-written SQL; read each generated SQL for its CHECKs. The workshop must run `standalone.ps1` to apply 0023-0025 (note in each migration PR description). E2E rows run on a throwaway `dforce_e2e` DB, never the dev DB. Gates per PR: `npx tsc --noEmit`, `npm test`, `npm run lint` (0 errors, 14 warnings), `gga run --pr-mode --diff-only` with `PR_BASE_BRANCH` pinned to the previous PR's branch. Browser checks at `http://<lan-ip>:3000` as administrador and técnico for every Server→Client boundary, portal or print change; read the console.

## WU1: Cédula / RUC (PR 1)

- [x] 1.1 RED `customers/validation.test.ts`: `normalizeDocumento` trims `"  8-123-456  "` to `"8-123-456"`, `""`/whitespace to `null`, 30 chars passes, 31 rejects "La cédula / RUC no puede superar 30 caracteres". GREEN `validation.ts`.
- [x] 1.2 `schema.ts`: `cliente.documento_identidad text` nullable, no unique, no CHECK. `drizzle-kit generate --name cliente_documento` (0023).
- [x] 1.3 RED `service.test.ts` trap: `updateCliente` with `"  8-1  "` persists `"8-1"` (`persistedPatch.documentoIdentidad` set from `normalizeDocumento`, as `phone`); `""` clears to null; omitted key leaves it. GREEN `service.ts` (create and update).
- [x] 1.4 RED import test: the customer import update leaves `documento_identidad` unchanged. GREEN only if it fails (import must not write it).
- [x] 1.5 RED `CustomerForm` tests: "Cédula / RUC" input sends `trim() || null`; clearing sends `null`, never `undefined`; toast convention unchanged. GREEN `CustomerForm.tsx`.
- [x] 1.6 RED customer detail test: shows the value when set, nothing when null. GREEN detail display.
- [x] 1.7 RED e2e `src/e2e/customer-documento.e2e.test.ts`: round-trip, duplicate value on two customers accepted, clearing via PATCH stores null. GREEN: fix real-SQL defects.
- [x] 1.8 Mutation-verify 1.1-1.7 by name (drop the explicit normalize in `updateCliente`, send `undefined`, write it in import).
- [x] 1.9 Browser at the LAN IP as administrador and técnico: customer form crosses a Server→Client boundary; console clean.

## WU2: Intake fields, navigation (PR 2)

- [x] 2.1 `schema.ts`: `kilometraje` integer CHECK 0..2000000, `nivel_combustible` smallint CHECK 0..4, `bateria_pct` smallint CHECK 0..100, nullable. `drizzle-kit generate --name orden_intake` (0024); confirm three CHECKs in SQL.
- [x] 2.2 RED `intake.test.ts`: `parseIntake` rejects -1, 1.5, "abc", fuel 5, battery 101 with Spanish errors per key; accepts null/omitted. `intakeInputsFor` for combustion, electrico, hibrido, null. `FUEL_LABEL` 0..4. GREEN client-safe `service-orders/intake.ts`.
- [x] 2.3 RED route tests (POST and PATCH `/api/service-orders`): valid values persist; invalid 400 and nothing persists; none given stores null; edit gate unchanged. GREEN both routes and `service.ts` types/values.
- [x] 2.4 RED `ServiceOrderForm` tests: inputs follow motor (fuel only, battery only, both, both); only VISIBLE fields are sent; edit sends `null` for a blank visible field and OMITS a hidden one. GREEN `ServiceOrderForm.tsx` plus new `motor` prop (create: from selected vehicle).
- [x] 2.5 RED `ServiceOrderFormTrigger` tests: create success calls `router.push("/service-orders/<id>")` after the toast; edit calls `router.refresh()`; failure never navigates. GREEN trigger (`onSaved(saved)`); detail page passes `vehiculo?.motor ?? null`.
- [x] 2.6 RED detail page tests: `85000` shown; null km shows "Sin kilometraje"; fuel 0..4 shows Vacío..Lleno; `bateria_pct = 80` and fuel 3 show "80%" and "3/4". GREEN `[id]/page.tsx`.
- [x] 2.7 RED e2e `src/e2e/order-intake.e2e.test.ts` (`dforce_e2e`): CHECKs reject 5, 101, -1 on direct insert; intake round-trips; null stays null. GREEN: fix real-SQL defects.
- [x] 2.8 Mutation-verify 2.2-2.7 by name (send hidden fields, navigate on failure, drop a CHECK).
- [x] 2.9 Browser at the LAN IP as both roles: create lands on detail; motor-aware inputs for all four vehicle kinds; 44x44 on new action controls (inputs at `h-8` are the field exception); console clean.

## WU3a: Photo table, R2, service (PR 3a)

- [x] 3.1 RED `catalog-storage/r2.test.ts`: the client is built with `requestChecksumCalculation` and `responseChecksumValidation` both `"WHEN_REQUIRED"`. GREEN `r2.ts`.
- [x] 3.2 `schema.ts`: `orden_servicio_foto(id text PK, orden_id FK cascade, r2_key, position smallint, created_by FK set null, created_at)` + `uniqueIndex(orden_id, position)`. `drizzle-kit generate --name orden_servicio_foto` (0025).
- [x] 3.3 RED `edit-policy.test.ts`: `canChangeOrderPhotos` true for open/in_progress, false for done/cancelled. GREEN over an exhaustive `Record<OrderStatus, boolean>`.
- [x] 3.4 RED `policy.test.ts`: `service-orders.deletePhoto` administrador true, tecnico false. GREEN `policy.ts`.
- [x] 3.5 RED `photos.test.ts` (injected seam): `isJpeg` rejects PNG and text labelled jpeg; `MAX_PHOTO_BYTES` 3 MB; throwing put leaves no row; commit failure after put calls `deleteObject`; 13th throws `PhotoLimitError`; closed order throws; delete runs gate then `DELETE … RETURNING r2_key`, then object delete (failure swallowed). GREEN `service-orders/photos.ts` (`FOR UPDATE`, count, `coalesce(max+1,0)`, insert, put; server `crypto.randomUUID()`).
- [x] 3.6 RED e2e `src/e2e/order-photos.e2e.test.ts` (`dforce_e2e`, put injected): 13 concurrent `addOrderPhoto` yield exactly 12 rows and one `PhotoLimitError`; positions ascend after a delete; throwing put rolls back to 0 rows; add on a `done` order refused; delete on `done` refused; cascade removes rows with the order. GREEN: fix real-SQL defects.
- [x] 3.7 Retention check: RED test that a retention run deletes nothing under `service-orders/`. GREEN only if it fails.
- [x] 3.8 Mutation-verify 3.1-3.7 by name (remove `.for("update")` so the 13-concurrent test goes red, drop the gate, put before insert, drop the checksum options).
- [x] 3.9 One real R2 PUT and GET with the new client options, plus an existing catalog PDF download, after the `r2.ts` change.

## WU3b: Photo routes (PR 3b)

- [x] 3.10 RED `route-guards.test.ts`: `/api/service-orders/[id]/photos` lists `POST: "service-orders.write"`; `/photos/[photoId]` lists `GET: "service-orders.read"`, `DELETE: "service-orders.deletePhoto"`. GREEN guard rows.
- [x] 3.11 RED POST route tests (injected deps): 201, 400 non-JPEG, 413 oversize (Content-Length pre-check at cap + 64 KB), 404, 409 `photo_limit` and `order_closed`, Spanish messages, no session refused. GREEN `src/app/api/service-orders/[id]/photos/route.ts`.
- [x] 3.12 RED GET/DELETE tests: GET returns `image/jpeg`, `ETag: photoId`, `Cache-Control: private, max-age=86400, immutable`, `nosniff`, sandbox CSP, looks up by `(photoId, ordenId)` (wrong order 404); técnico DELETE 403 and row kept; administrador DELETE removes row and object; closed order 409. GREEN `[photoId]/route.ts`.
- [x] 3.13 Mutation-verify 3.10-3.12 by name (look up by `photoId` only, trust declared content type, drop the 403).
- [ ] 3.14 curl at the LAN IP as both roles: unauthenticated GET refused, técnico DELETE 403.

## WU4: Compression and uploader card (PR 4)

- [ ] 4.1 RED `compress-photo.test.ts`: pure `fitWithin(w, h, 1600)` for landscape, portrait, already-small (no upscale); `toBlob` returning `null` throws. GREEN `compress-photo.ts` (`createImageBitmap` with `imageOrientation: "from-image"`, `HTMLImageElement` + `URL.createObjectURL` fallback; no secure-context API).
- [ ] 4.2 RED `OrderPhotos` tests: uploads sequentially with "Subiendo 2 de 5…" in `aria-live`; a failed file gets its own error toast; success toast reports the APPLIED count ("1 foto agregada" / "3 fotos agregadas"), above `router.refresh()`, both below the `try/catch`; input has no `capture`; add control hidden when `canAdd` false; delete hidden for técnico; delete confirm then "Foto eliminada". GREEN `OrderPhotos.tsx` (props `{orderId, photos:{id}[], canAdd, canDelete}`, label with `buttonVariants` + `min-h-11 min-w-11`).
- [ ] 4.3 RED detail page tests: card "Fotos de recepción" gets `canAdd` from `canChangeOrderPhotos` and `service-orders.write`, `canDelete` from `can(..., "service-orders.deletePhoto")` and status; photos listed by position. GREEN `[id]/page.tsx`.
- [ ] 4.4 Mutation-verify 4.1-4.3 by name (count `files.length` instead of applied, upload in parallel, show delete to técnico).
- [ ] 4.5 Browser at the LAN IP as administrador and técnico (RSC boundary, confirm dialog is a portal: console clean); target sizes measured.
- [ ] 4.6 Real phone over HTTP: gallery and camera both offered, multi-select works, compression runs with no secure context, photos arrive at ~300-600 KB. Confirms dropping `capture` with the owner.

## WU5: Print (PR 5)

- [ ] 5.1 RED print page tests: Cédula / RUC beside nombre and teléfono when set, absent when null; Kilometraje row; fuel and battery rows only when set; sentinel renewal month and insurance expiry absent. GREEN `print/page.tsx` (named-field allowlist).
- [ ] 5.2 RED QR slot test: `aria-hidden` element of `size-[25mm]` in the header with no text and no border classes. GREEN `print/page.tsx`.
- [ ] 5.3 RED photo chunk tests: 0 photos renders no photo block; 4 → 1 chunk; 5 → 2; 9 → 3 (4/4/1) in position order; each chunk `break-before-page`, `loading="eager"`, `src` the authenticated route. GREEN chunking.
- [ ] 5.4 RED `PrintButton` test: click awaits `decode()` for every incomplete image before `window.print()`; a rejected decode still prints. GREEN `PrintButton.tsx`.
- [ ] 5.5 Mutation-verify 5.1-5.4 by name (render all photos in one grid, print before decode resolves, render the whole vehicle row).
- [ ] 5.6 Print PREVIEW at the LAN IP (not the page): photo-less order is exactly 1 page; 9 photos is 4 pages (4/4/1 from page 2); measure the signature stays on page 1 with photos absent AND present; light sheet in dark theme; QR slot blank.

## Spec archive notes

- [ ] 6.1 At archive, merge the two delta specs: `customer-management` MODIFIES R17; `service-orders` ADDS two requirements plus Reception Photos and MODIFIES two (not renames). Check for duplicates after the mechanical apply.
- [ ] 6.2 Follow-ups, not in scope: QR code and customer portal (step 4); técnico/`jefe_taller` changes (step 3); orphan R2 sweeper; photo annotation; Cédula/RUC import.
