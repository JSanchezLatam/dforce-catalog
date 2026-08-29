# Tasks: Vehicles one-to-many (C3)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1000–1100 total (proposal.md Risks), split 150–200 / 450–550 / 400–500 across 3 slices (design.md Migration/Rollout) |
| Session review budget | 800 (session override; skill default 400 not applicable) |
| 400-line budget risk | Slice 1: Low · Slice 2: Medium (tightest, 450–550 vs 800) · Slice 3: Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (schema + `0013`) → PR 2 (validation/queries/service/API + E2E) → PR 3 (form/pages/picker/fixtures + `0014`) |
| Delivery strategy | ask-on-risk |
| Chain strategy | **Sequential to `main`, confirmed by the owner.** Each slice opens against `main`, merges, and only then does the next branch off a clean `main`. No tracker branch, no stacking, no rebasing when review changes an earlier slice. Chosen over a feature-branch-chain because expand/contract already makes every slice independently shippable, and because GGA's `--pr-mode` always resolves to `main` (AGENTS.md, known defect #2/#3) — a chained branch re-reviews every ancestor commit, which produced a false scope-creep finding on the previous change. Between slice 1 and slice 3 `main` carries the new table alongside the old columns; that is what expand/contract is for. |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: Medium

If slice 2's API/E2E work grows past ~550 authored lines, split the `vehicle search (E2E)` block into its own PR against the same wu2 branch rather than silently exceeding the 800 budget.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | `vehiculo` table + `0013` (create + backfill), `cliente` columns untouched | PR 1 → `main` | `npm test -- schema.test` | Manual live smoke only (see Phase 1.5) — `beforeAll` migrates before any pre-migration row can exist | `DROP TABLE vehiculo`; `cliente` untouched — clean revert |
| 2 | `planVehiculoReconcile`, `validateVehiculoInput`, `EXISTS`/`plates[]` queries, transactional `service.ts` | PR 2 → `main` (after PR 1 merges) | `npm test -- vehicles.test validation.test queries.test service.test` | `npm run test:e2e` (`vehicle search (E2E)`, real Postgres, port 5433) | Code-only `git revert`; `0013` stays harmless and inert without this slice |
| 3 | `CustomerForm` repeating group, pages, picker one-liner, fixtures, `0014` (drop columns) | PR 3 → `main` (after PR 2 merges) | `npm test -- CustomerForm.test` | N/A — UI wiring only; behaviour already proven by unit 2's harnesses | **None** — `0014` is irreversible past this point; roll back before merge or accept the loss (design.md Migration/Rollout) |

## Phase 1: Slice 1 — Schema + Migration `0013` (branch: `vehicles/wu1-schema-and-migration`, current)

- [ ] 1.0 No tracker branch. `vehicles/wu1-schema-and-migration` is already cut from `main` and targets `main` directly.
- [ ] 1.1 RED — `src/shared/db/schema.test.ts`: `vehiculo` via `getTableConfig` — columns `id`/`clienteId`/`make`/`model`/`year`/`plate`/`deactivatedAt`/`createdAt`; FK `cliente_id → cliente.id` `onDelete: "cascade"` (D1); index `vehiculo_plate_idx`; assert `cliente`'s 4 vehicle columns + `cliente_plate_idx` are still present (proves this slice does not touch `cliente`).
- [ ] 1.2 GREEN — `src/shared/db/schema.ts`: add `vehiculo` pgTable + `Vehiculo` type — `deactivatedAt: timestamp("deactivated_at", { withTimezone: true })` nullable, no boolean (D3); FK cascade (D1); `cliente` unchanged.
- [ ] 1.3 `npx drizzle-kit generate --custom --name vehiculo_table` → `0013_<name>.sql` + meta snapshot. Do not hand-write the `.sql` (no journal entry, Drizzle won't run it — `0011`/`0012` precedent).
- [ ] 1.4 Edit the generated `0013` body: `CREATE TABLE vehiculo (...)`, `CREATE INDEX vehiculo_plate_idx ON vehiculo(plate)`, then `INSERT INTO vehiculo (id, cliente_id, make, model, year, plate) SELECT gen_random_uuid(), id, vehicle_make, vehicle_model, vehicle_year, vehicle_plate FROM cliente WHERE vehicle_plate IS NOT NULL` (D2 backfill condition — `deactivated_at` left NULL/active).
- [ ] 1.5 MANUAL live smoke test (NOT automated — `beforeAll` runs `drizzle-kit migrate` before any seed can exist in the pre-migration shape): apply `0013` against the real dev DB; verify by eye exactly 1 `vehiculo` row, make/model/year/plate matching the pre-migration `cliente` row, `deactivated_at IS NULL`; `cliente`'s 4 columns still present; `orden_servicio` untouched (0 rows). Record the check in the PR description.
- [ ] 1.6 Full suite (`npm test`) + `npx tsc --noEmit` + lint — hold baseline 868 unit / 12/12 e2e (unaffected this slice) / tsc 0 / lint 0 errors, ≤15 warnings.
- [ ] 1.7 Manual GGA pass: `GGA_PROVIDER=claude gga run --pr-mode --diff-only`; re-run after every fix (non-deterministic).
- [ ] 1.8 Open PR #1 → base `main`. Note in the description: `main` already carries two unpushed commits (dev.sh admin-seed fix, customer-search-and-picker archive) that ride along — intended.

## Phase 2: Slice 2 — Validation, Queries, Service, E2E (branch off `vehicles/wu1-schema-and-migration`)

- [ ] 2.0 Branch `vehicles/wu2-collection-write-and-search` off `vehicles/wu1-schema-and-migration`.
- [ ] 2.1 RED — `src/modules/customers/vehicles.test.ts` (new): `planVehiculoReconcile(existing, incoming)` — `incoming` omitted leaves inserts/updates/deactivate all empty; `incoming: []` deactivates every existing active id; an element without `id` → inserts; an element with `id` matching an existing active vehicle → updates; an element with an `id` foreign to this customer → throws (never a silent insert); an existing vehicle absent from `incoming` → deactivate; re-adding a previously deactivated plate inserts a new row rather than resurrecting the old one (D5).
- [ ] 2.2 GREEN — `src/modules/customers/vehicles.ts` (new, sole owner of `vehiculo` reads/writes — D3 "one owner"): `VehiculoInput`/`VehiculoPlan` types, pure `planVehiculoReconcile`; `activeVehiculoFilter()` (`isNull(vehiculo.deactivatedAt)`); `platesSubquery()`.
- [ ] 2.3 RED — `src/modules/customers/validation.test.ts`: `validateClienteInput` no longer accepts/returns the 4 vehicle fields (drop the old cross-field assertions); new cases for `validateVehiculoInput` — plate required, make/model/year optional; a vehicle with `make` but no `plate` rejects.
- [ ] 2.4 GREEN — `src/modules/customers/validation.ts`: remove the 4 vehicle fields from `ClienteInput` and the `hasOtherVehicleField` block; add `validateVehiculoInput(input): VehiculoInput` requiring `plate` per-vehicle (D6).
- [ ] 2.5 RED — `src/modules/customers/queries.test.ts`: extend the `compileSearchWhere`/`PgDialect().sqlToQuery()` pattern (line 11) — assert the plate branch compiles to `exists (select 1 from "vehiculo" where "vehiculo"."cliente_id" = "cliente"."id" and "vehiculo"."deactivated_at" is null and unaccent("vehiculo"."plate") ilike unaccent($n))`, specifically asserting the `"deactivated_at" is null` substring (D3/D4 — this is the test that fails if the soft-delete filter is forgotten).
- [ ] 2.6 GREEN — `src/modules/customers/queries.ts`: `buildClienteSearchWhere`'s plate branch → `EXISTS(...)` (D4); `ClienteListItem.plates: string[]` via correlated `array_agg(v.plate order by v.created_at)` subselect; `getClienteById` adds `vehicles: Vehiculo[]` via one more `select` in its existing `queryFn`.
- [ ] 2.7 RED — `src/modules/customers/service.test.ts`: fake `deps.database.transaction` (`account/service.test.ts` precedent) — `createCliente`/`updateCliente` accept `vehicles?: VehiculoInput[]` beside the scalars; a thrown insert aborts the whole write; a patch with `vehicles` omitted leaves the vehicle collection untouched; the existing scalar-merge test (line 81) still passes unchanged.
- [ ] 2.8 GREEN — `src/modules/customers/service.ts`: `vehicles?` sits beside the scalar patch, never inside `validateClienteInput`'s spread; wrap create/update in `db.transaction`, call `planVehiculoReconcile`, execute inserts/updates/deactivate via `vehicles.ts`'s Drizzle builders on `tx` (not hand-written SQL — D5).
- [ ] 2.9 RED — `src/app/api/customers/route.test.ts` + `[id]/route.test.ts`: request body's `vehicles` array reaches `createCliente`/`updateCliente` unchanged; 400/409/404 error mapping unchanged.
- [ ] 2.10 GREEN — `route.ts`/`[id]/route.ts`: confirm/adjust types only for `ClienteInput`'s shrunk shape; no new branching logic (body already passes through to `deps`).
- [ ] 2.11 New `vehicle search (E2E)` describe in `src/e2e/full-flow.e2e.test.ts`, following `customer search (E2E)`'s exact discipline (`beforeAll` → `execSync("npx drizzle-kit migrate")`, seed via captured ids, `afterAll` deletes those `cliente` ids — vehicles cascade): (a) a 3-vehicle customer matches by the 2nd/3rd plate, not only the 1st; (b) a zero-vehicle customer still matches by name/phone; (c) a soft-deleted vehicle disappears from search while its customer stays findable by name; (d) `plates` returns as a real multi-element array from `array_agg`.
- [ ] 2.12 Full suite + `tsc` + lint — baseline 868+new unit tests, `tsc` 0, lint 0 errors/≤15 warnings.
- [ ] 2.13 Run the E2E for real: `docker compose exec -T db psql -U dforce -d postgres -c "DROP DATABASE IF EXISTS dforce_e2e;" -c "CREATE DATABASE dforce_e2e;"` then `DATABASE_URL="postgres://dforce:dforce@localhost:5433/dforce_e2e" npm run test:e2e` — recreate the DB every run (the catalog describe seeds users it never cleans up). Hold 12/12 + new cases.
- [ ] 2.14 Manual GGA pass, re-run after every fix.
- [ ] 2.15 Branch slice 2 off `main` only AFTER PR #1 has merged, then open PR #2 → base `main`. If slice-1 changes appear in this diff, the branch was cut too early.

## Phase 3: Slice 3 — Form, Pages, Picker, Fixtures, Migration `0014` (branch off wu2)

- [ ] 3.0 Branch `vehicles/wu3-form-and-contract` off `vehicles/wu2-collection-write-and-search`.
- [ ] 3.1 RED — `src/modules/customers/CustomerForm.test.tsx`: add/remove vehicle rows; saving with zero rows sends `vehicles: []`; each row's own plate-required error surfaces independently; Spanish copy present.
- [ ] 3.2 GREEN — `src/modules/customers/CustomerForm.tsx`: replace the 4 flat vehicle inputs (lines 183–222) with a repeating-group array state (add/remove row), Spanish labels ("Vehículos", "Agregar vehículo", "Quitar"); `buildPayload` sends `vehicles: VehiculoInput[]`.
- [ ] 3.3 `src/app/(app)/customers/page.tsx`: `Placa` column (line 107) → `item.plates.join(", ")`, reusing `CustomerPicker`'s convention; drop the `vehiclePlate` reference.
- [ ] 3.4 `src/app/(app)/customers/[id]/page.tsx`: replace the single `vehicle`/`Placa` fields (lines 65, 91) with a per-vehicle detail block iterating the query's `vehicles: Vehiculo[]` (2.6).
- [ ] 3.5 `src/modules/service-orders/CustomerPicker.tsx` line 169: drop the local `const plates = customer.vehiclePlate ? [...] : []` conversion; call `identifierFor(customer, customer.plates)` directly.
- [ ] 3.6 Fixture-only updates (mechanical — zero vehicle-column references in the implementations themselves): `reminders/job.test.ts`, `reminders/schedule.test.ts`, `ServiceOrderForm.test.tsx`, `CustomerPicker.test.tsx`, `api/customers/route.test.ts`, `api/customers/[id]/route.test.ts` — replace any `vehiclePlate` fixture field with `plates: string[]`.
- [ ] 3.7 `npx drizzle-kit generate --custom --name drop_cliente_vehicle_columns` → `0014_<name>.sql`.
- [ ] 3.8 Edit generated `0014` body: `ALTER TABLE cliente DROP COLUMN vehicle_make, DROP COLUMN vehicle_model, DROP COLUMN vehicle_year, DROP COLUMN vehicle_plate; DROP INDEX cliente_plate_idx;` — irreversible past this point (design.md Migration/Rollout); do not merge before slice 3 is fully ready.
- [ ] 3.9 `src/shared/db/schema.ts`: remove the 4 `cliente` vehicle columns + `cliente_plate_idx`; update the stale "inline single vehicle (v1, ADR-6)" doc comment.
- [ ] 3.10 RED→GREEN — `schema.test.ts`: assert `cliente`'s 4 vehicle columns and `cliente_plate_idx` are now absent (extends the slice-1 test that asserted they were untouched).
- [ ] 3.11 Full suite + `tsc` + lint.
- [ ] 3.12 Manual GGA pass, re-run after every fix.
- [ ] 3.13 Branch slice 3 off `main` only AFTER PR #2 has merged, then open PR #3 → base `main`. `0014` drops the columns here and is the one irreversible step: do not merge until the whole slice is ready.

## Success Criteria Traceability

- [ ] Backfill preserves the one existing vehicle → 1.5 (manual)
- [ ] 2nd/3rd-plate match, zero-vehicle match, soft-delete exclusion, `plates[]` shape → 2.11 (E2E)
- [ ] Per-vehicle plate rule (R17 relocated) → 2.1–2.4
- [ ] `orden_servicio` byte-for-byte unchanged → 1.1/1.6/2.12/3.11 (full suite holds baseline; no `orden_servicio` file touched anywhere in this plan)
- [ ] `npm test` / `tsc --noEmit` clean each slice → 1.6, 2.12, 3.11
