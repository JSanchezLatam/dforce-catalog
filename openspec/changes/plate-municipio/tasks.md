# Tasks: Plate Municipio

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~450 total: WU1 ~230, WU2 ~220; generated drizzle snapshot excluded |
| 400-line budget risk | Medium (tests dominate; fixture sentinels touch many files) |
| Chained PRs recommended | Yes |
| Suggested split | Tracker branch off main; PR 1 (server) → PR 2 (UI, based on PR 1); tracker merges to main |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Column, validation, tri-state save, 403 gate, leak sentinels, e2e | PR 1 (base: tracker branch) | `npx vitest run src/modules/customers src/app/api/customers src/modules/service-orders` | e2e on throwaway DB (`vehicle-details`, `vencimientos`) | Revert PR 1; migration 0026 is additive |
| 2 | Form input, vehicle detail, due-row display, browser check | PR 2 (base: PR 1 branch) | `npx vitest run src/modules/customers "src/app/(app)/vencimientos" "src/app/(app)/customers"` | Playwright at `http://192.168.0.3:3000`, 390/768/desktop | Revert PR 2; stored data and API stay |

Rule for every pair: RED test, confirm red BY NAME, GREEN, mutation-verify (revert the fix, the named test goes red). Fixtures match the wire. Migration from `drizzle-kit generate --name plate_municipio`, never hand-written; if `closed-order-lock` merges first, regenerate on top of it, never renumber a snapshot. Gates per PR: `npx tsc --noEmit`, `npm test`, `npm run lint` (0 errors, 14 warnings), `gga run --pr-mode --diff-only` with `PR_BASE_BRANCH` pinned to the previous branch.

## WU1: Server (PR 1)

- [x] 1.1 RED `validation.test.ts`: `"  San Miguelito "` trimmed; `""` and `"   "` null; absent stays absent; 81 chars errors "El municipio no puede superar 80 caracteres"; 80 accepted; number errors "El municipio no es válido". GREEN `validation.ts`.
- [x] 1.2 RED `vehicles.test.ts`: update without the key has no `placaMunicipio` in SET; `null` clears; insert defaults null; `sendsInternalVehiculoFields` true for `null`, false for `undefined`. GREEN `vehicles.ts`; mutation-verify by deleting the spread guard.
- [x] 1.3 RED refusal rows: add key (null included) to `it.each` in `api/customers/route.test.ts` and `[id]/route.test.ts` (tecnico 403, nothing stored) and `[id]/vehicles/route.test.ts` (400 for all). GREEN `COLLECTION_ONLY_FIELDS` in `vehicles/route.ts`.
- [x] 1.4 RED leak: `placaMunicipio: "SENTINEL-MUNICIPIO"` in every POISONED fixture (vehicles GET, `toPublicVehiculo`, customer page tecnico props, order detail, print sheet); sentinel absent. `tsc` forces the other `Vehiculo` fixtures. Mutation-verify: spread the full row into each allowlist, each goes red by name.
- [x] 1.5 `schema.ts`: `placaMunicipio: text("placa_municipio")` after `placaRenovacionMes`; run `drizzle-kit generate --name plate_municipio` (0026); confirm one `ADD COLUMN`, no default.
- [x] 1.6 RED e2e `vehicle-details.e2e.test.ts` (throwaway DB): create with municipio; tecnico PATCH keeps it; tecnico sending `null` gets 403; admin `"  X "` stores `"X"`, `""` stores null. GREEN: fix real-SQL defects.
- [x] 1.7 RED e2e `vencimientos.e2e.test.ts`: `listDueCandidates` returns `placaMunicipio`. GREEN `queries.ts`, `service.ts` (`DueCandidate`/`DueVencimiento`).

## WU2: UI (PR 2)

- [ ] 2.1 RED `CustomerForm.test.tsx`: grant sends trimmed value, or `null` when blank; no grant omits the key and shows no control; row error under the input. GREEN `CustomerForm.tsx` (Pick, row state, payload, `<Input maxLength={80}>` "Municipio de la placa" on its own row, `ROW_ERROR_FIELDS`).
- [ ] 2.2 RED vehicle detail page test: "Municipio de la placa" shows for admin, hidden without grant and when null. GREEN `customers/[id]/vehicles/[vehicleId]/page.tsx`.
- [ ] 2.3 RED `vencimientos/page` test: placa row shows "San Miguelito"; seguro row for the same vehicle does not; null shows no "null" or placeholder. GREEN `toItem` and `Vehicle` (`flex-wrap`, `min-w-0 break-words`).
- [ ] 2.4 Mutation-verify 2.1-2.3 (drop the grant gate, drop the `kind === "placa"` check).
- [ ] 2.5 Playwright at `http://192.168.0.3:3000` (not localhost), 390px, 768px, desktop: an 80-char municipio wraps in the due card and table cell with no horizontal overflow; form row fits; console clean (RSC, hydration); `Pagination`-style volume traps need rows in dev DB.

## Deployment and archive notes

- [ ] 3.1 Migration note in the PR body: the workshop PC must run `standalone.ps1` (migration 0026) or the due page and vehicle detail error on the missing column.
- [ ] 3.2 At archive, merge the MODIFIED `vehicle-renewals` requirements (not a rename). Follow-ups out of scope: municipio picker, filtering, contact message.
