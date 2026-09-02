# Tasks: Service History per Vehicle (C4)

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 950–1050 (WU1 420–470, WU2 ~300, WU3 ~280) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | WU1 → WU2 → WU3 |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Schema+migration 0015, vehicle validation, picker, SEAM, e2e | PR1 (base: tracker) | `npm test -- schema service vehicles ServiceOrderForm` | e2e against throwaway PG (`vehicle search` block) | Drop 5 columns+enum type; revert branch |
| 2 | Category+notes wiring, widened `updateOrder`, detail rows | PR2 (base: PR1) | `npm test -- service categories route page` | N/A — code-only, covered by `npm test` | Revert branch, code-only |
| 3 | Vehicle detail route, history read, clickable cards | PR3 (base: PR2) | `npm test -- queries` | e2e "two vehicles" case, same harness as WU1 | Revert branch, code-only |

## WU1 — Schema, vehicle validation, picker, SEAM, e2e (~420–470 lines) [PR1, base: tracker]

- [x] 1.1 Re-run `select count(*) from orden_servicio`; must be 0 before generating migration 0015. — Owner-verified live against the dev DB on 2026-09-01: 0 rows.
- [x] 1.2 `schema.ts`: add `vehiculoId` (FK `vehiculo`, NOT NULL, `restrict`), `ordenCategoriaEnum` (5 unaccented slugs: `instalacion`, `mant_preventivo`, `mant_correctivo`, `reparacion`, `revisado`), 3 nullable text note columns, `orden_vehiculo_created_idx` on `(vehiculoId, createdAt)`.
- [x] 1.3 `npx drizzle-kit generate --name order_vehiculo_category_notes`; verify `0015_*.sql`; never `--custom`. — Snapshot verified as a real diff against 0014 (owner-checked while apply was down).
- [x] 1.4 RED/GREEN `schema.test.ts`: structural NOT NULL/FK/index/enum assertions for the 5 new columns (mirrors existing `status`/FK test pattern; no live DB in this suite).
- [x] 1.5 RED `service.test.ts`: `createOrder` rejects unknown vehicle, customer-B's vehicle, an inactive vehicle (inject `deps.getClienteById`).
- [x] 1.6 GREEN `service.ts`: required `vehiculoId`+`categoria` on `CreateOrdenServicioInput` (enum-typed inline — named `ServiceCategory` alias lands in WU2, required now because migration 0015's NOT NULL must be satisfiable via API/e2e before the UI select ships); ownership check against `clienteDetail.vehicles`; `InvalidVehiculoError`; thread both into the insert.
- [x] 1.7 GREEN `route.ts`: map `InvalidVehiculoError` → 400 `{errors:{vehiculoId}}`.
- [x] 1.8 RED/GREEN `service.test.ts`: a create payload carrying `hallazgos` never reaches the insert — pins the `.values()` map as the load-bearing whitelist for all 5 new columns.
- [x] 1.9 RED/GREEN `vehicles.test.ts`: fake `TxLike.select` returns a row for `plan.delete` → `ClienteValidationError({vehicles})`; `select` uncalled for deactivate-only plans.
- [x] 1.10 GREEN `vehicles.ts`: fill the SEAM exactly per D4, inside `tx`, above the DELETE.
- [x] 1.11 Create `api/customers/[id]/vehicles/route.ts` (+test): `GET`, `customers.read`, active-only, `listVehiculosByCliente(id)`.
- [x] 1.12 RED `ServiceOrderForm.test.tsx`: customer change clears `vehiculoId` in the same handler; zero-vehicle directive message + disabled submit.
- [x] 1.13 GREEN `ServiceOrderForm.tsx`: vehicle picker, fetch-on-customer-change with `cancelled`-flag guard, submit gate `|| (!isEdit && !vehiculoId)`. — Native `<select>`, not the base-ui `Select` (no existing test/shim exercises it in jsdom); noted as a deviation below.
- [x] 1.14 E2E (`full-flow.e2e.test.ts`, extend `vehicle search`): NOT NULL rejects order without `vehiculoId`; FK rejects nonexistent `vehiculoId`; `RESTRICT` blocks a raw vehicle delete; SEAM refuses delete of a vehicle with history (400, row survives); deactivating that same vehicle still succeeds (200), row still present (direct DB check). — **Code written, NOT run.** `docker`/`docker.app`, `colima`, and `podman` are all absent from this machine (not merely a stopped daemon — `docker` resolves to a dead symlink, `/Applications/Docker.app` does not exist). A native Postgres answers on `localhost:5432` but is NOT used as a substitute — it may be the real dev DB per this project's own documented two-`dforce_catalog`-databases hazard, and the instruction was explicit: recreate a THROWAWAY database every run, stop rather than report green on a skip. Blocked until Docker (or an equivalent disposable Postgres) is available. — RUN AND GREEN: 29/29 against a freshly created throwaway Postgres. Docker Desktop is broken on this machine (555MB bundle, no `docker` binary), so the disposable database was created on the native Homebrew Postgres as `dforce_c4_e2e` and dropped afterwards; `dforce_catalog` was never touched. Three of the five cases initially failed because Drizzle wraps the driver error in its own `Failed query:` string — rewritten to assert the SQLSTATE (23502 / 23503) and the constraint NAME instead, which is stronger than the message match it replaced. SEAM verified by mutation: disabling the guard turns the 400 into a pass-through and the e2e goes red.
- [x] 1.15 `npm test` and `npx tsc --noEmit` clean. — 1003/1003 unit+component tests green, tsc clean. Does NOT include e2e (1.14, separately blocked) — per AGENTS.md's known coverage limit, this proves the app-level logic only, zero real-SQL coverage of the FK/NOT NULL/RESTRICT/SEAM.
- [ ] 1.16 Owner action: open PR1 against the tracker branch.
- [ ] 1.17 Owner action: `GGA_TIMEOUT=900 GGA_PROVIDER=claude gga run --pr-mode --diff-only`, cap 5 rounds.

## WU2 — Category + notes wiring (~300 lines) [PR2, base: PR1 branch]

- [x] 2.1 RED/GREEN `categories.test.ts`+`categories.ts`: `ServiceCategory` type + `CATEGORIA_LABEL` covers every `ordenCategoriaEnum.enumValues` entry; re-point `service.ts`'s inline categoria type to this alias. — RED confirmed (module didn't exist, import failure). GREEN: 3/3. Triangulation: all 5 enum values covered + 2 distinct-label spot checks (`revisado` → "REVISADO", `mant_preventivo` vs `mant_correctivo`). `service.ts` now imports `ServiceCategory` from `./categories` instead of inlining `(typeof ordenCategoriaEnum.enumValues)[number]`; dropped the now-unused `ordenCategoriaEnum` import there.
- [x] 2.2 RED/GREEN `service.test.ts`+`service.ts`: widen `UpdateOrdenServicioPatch`/`updateOrder` for `categoria`+3 notes, other fields untouched. — `updateOrder` already applies `patch` generically via `.set(patch)`, so RED was confirmed at the TYPE level (`npx tsc --noEmit`: TS2353 "categoria does not exist in type UpdateOrdenServicioPatch" on both new test cases) rather than a runtime failure — the runtime behavior was already correct, only the type was too narrow. GREEN: widened the type, tsc clean, 30/30 (2 new: persists categoria+3 notes; leaves other fields like description untouched when only categoria is patched).
- [x] 2.3 RED/GREEN `[id]/route.test.ts`+`route.ts`: PATCH whitelists exactly `description`/`appointmentAt`/`categoria`/3 notes. — RED confirmed (whitelist test failed: stray `vehiculoId` reached `.set()` before the fix; a companion test needed rewriting mid-cycle because the existing `fakeDb` helper ignores its `.set()` argument entirely, which made the naive first version pass trivially with zero implementation — replaced with a `setSpy` that asserts the actual patch object). GREEN: 7/7, whitelist now covers exactly the 6 named fields.
- [x] 2.4 `ServiceOrderForm.tsx`: category `<Select>` (both create and edit modes); 3 note fields behind `isEdit &&`. — Native `<select>`, same rationale as WU1's vehicle picker (no jsdom shim for base-ui `Select` in this repo yet). RED: 4 new tests failed (category select / note fields didn't exist). GREEN: 10/10, including 2 tests proving `categoria` reaches the POST body and `categoria`+`hallazgos` reach the PATCH body (not just that the UI renders). Notes use native `<textarea>` — no `Textarea` UI component exists in this repo and adding one was out of this task's scope. Category select default is the enum's first value (`instalacion`) rather than an empty placeholder, since `categoria` is DB NOT NULL with no default (design D5) — this needed no extra submit-gate change.
- [x] 2.5 `service-orders/[id]/page.tsx`: vehicle link, category, 3 note rows — pass `orden.<field> ?? "—"` at the three call sites only; do not modify `field()`. — No test file (this repo has zero `page.tsx` tests anywhere — server-component pages are untested at this layer by existing convention; e2e coverage for this page is out of WU2 scope per the Docker-broken constraint). Vehicle rendered as a `Link` block mirroring the existing Cliente cell (not via `field()`, since it needs conditional Link markup), resolved from `clienteDetail.vehicles.find(v => v.id === orden.vehiculoId)` — `getClienteById` already reads with `includeInactive: true`, so a deactivated vehicle still resolves and links (spec scenario). Categoria shown via `CATEGORIA_LABEL[orden.categoria]` (always set, no `??` needed). The 3 note rows are the ONLY 3 `?? "—"` call sites, exactly as scoped — `field()` itself untouched.
- [x] 2.6 `npm test` and `npx tsc --noEmit` clean. — 1015/1015 tests green (1003 baseline + 12 new), `npx tsc --noEmit` clean project-wide, `npm run lint` at the existing baseline (0 errors/15 warnings). Total WU2 diff: ~384 changed/added lines (9 modified files + 2 new files), well inside the 800-line budget.
- [x] 2.9 Hardening (owner-approved, added after the 2.1-2.6 review): validate `categoria` at the API trust boundary. Both write paths accepted an arbitrary value straight from the JSON body — POST hands the raw `body` to `createOrder`, PATCH copied `body.categoria` into the patch — so an unknown value reached Postgres and the caller got a 500 where a 400 is owed. `status` on the same PATCH route has no such hole only because `assertTransition` rejects it downstream; `categoria` had no downstream guard. GREEN: `isServiceCategory()` exported from `categories.ts` (the enum's own module) and applied at both routes -> 400 `{errors:{categoria}}`. RED confirmed first: 6 new tests failed (3 guard unit tests, POST invalid + POST missing, PATCH invalid), and the PATCH case asserts the update spy was never called. The pre-existing "unknown clienteId" POST test now sends a valid `vehiculoId`/`categoria`, so it still exercises the unknown-cliente path instead of tripping the new guard. 1021/1021 tests, tsc clean, lint at its 15-warning baseline.

- [ ] 2.7 Owner action: open PR2 against PR1's branch.
- [ ] 2.8 Owner action: GGA, same command as 1.17.

## WU3 — Vehicle detail, history, cards (~280 lines) [PR3, base: PR2 branch]

- [ ] 3.1 RED/GREEN `queries.test.ts`+`queries.ts`: `listOrdenesByVehiculo(vehiculoId)`, `desc(createdAt)`, scoped to one vehicle.
- [ ] 3.2 Create `customers/[id]/vehicles/[vehicleId]/page.tsx`: `getClienteById(id)`+`vehicles.find` (miss → `notFound()`) + `listOrdenesByVehiculo`; breadcrumb, identity card, history table ("Ver" → `/service-orders/[id]`), empty state.
- [ ] 3.3 `customers/[id]/page.tsx`: both active and deactivated vehicle cards become links.
- [ ] 3.4 E2E: two vehicles on one customer, each with orders → history returns only the queried vehicle's rows.
- [ ] 3.5 `npm test` and `npx tsc --noEmit` clean.
- [ ] 3.6 Owner action: open PR3 against PR2's branch.
- [ ] 3.7 Owner action: GGA, same command as 1.17.
