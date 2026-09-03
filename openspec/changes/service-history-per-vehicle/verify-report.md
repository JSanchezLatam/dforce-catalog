```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:a58f1e9476d4b5ace51c21d421f0e6408a2e7995bc662fb5f33c724ab6788c0b
verdict: fail
blockers: 0
critical_findings: 7
requirements: 6/6
scenarios: 23/30
test_command: npm test -- --run
test_exit_code: 0
test_output_hash: sha256:4c27d82f540295bc76216b004b2952d4ac897f7e76535c7495ab29380d34ae82
build_command: npx tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: service-history-per-vehicle (C4)
**Version**: N/A (no `specs/*/spec.md` version header; delta-format specs)
**Mode**: Strict TDD

**HEAD verified**: `fix/server-timezone-rendering` @ `f5a25b3`, tip of a 5-branch, 5-PR chain (PR #57 → #58 → #59 → #60 → #61), none merged to `main`/tracker. Full diff `feat/c4-service-history..HEAD`: 35 files changed, 3806 insertions(+), 112 deletions(-).

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 47 (WU1 19, WU2 12 incl. 2.10, WU3 16 incl. 3.12/3.15) |
| Tasks complete `[x]` | 39 |
| Tasks open `[ ]` (follow-ups, intentionally not scoped) | 8 (1.18, 1.19, 2.11, 2.12, 3.10, 3.11, 3.13, 3.15) |

No task is incomplete in the sense of "should have been done but wasn't" — every open checkbox is a follow-up explicitly recorded as out of scope. Full verification proceeds.

### Build & Tests Execution
**Build**: PASSED — independently re-run in this verify session (not reused from the orchestrator's report)
```text
$ npx tsc --noEmit
(no output, exit 0)
```

**Tests**: PASSED — independently re-run in this verify session
```text
$ npm test -- --run
 Test Files  76 passed (76)
      Tests  1060 passed (1060)
   Duration  74.04s
```
Both numbers match the orchestrator-reported figures exactly (0 tsc errors; 76 files / 1060 tests). `npm run lint` was NOT independently re-run here (reported: 0 errors / 15 warnings, the repo's standing baseline) — treated as reported evidence, low risk since lint is non-blocking by contract.

**e2e**: NOT run in this verify session (real-Postgres, throwaway-DB setup, out of this pass's read-only/time budget). Last recorded run: 31/31 against a throwaway `dforce_c4_e2e` on native Postgres, per tasks.md 3.5 and Engram apply-progress. **Labelled as REPORTED evidence, not independently re-verified.** Source-read cross-check: every e2e scenario the tasks claim (NOT NULL, FK, RESTRICT, SEAM 400, deactivate-succeeds, two-vehicle scoping) is present as a distinct `it(...)` block in `src/e2e/full-flow.e2e.test.ts` (see Spec Compliance Matrix) — the claims are structurally real, only their last green run is unverified by this session.

**Coverage**: not measured (no coverage tool run this session; not requested).

### Task-Claim Audit (highest-value pass — every `[x]` checked against code)

All checked tasks were cross-read against the actual source. No stale or overstated claim found in this pass:

| Task | Claim | Verified against |
|---|---|---|
| 1.2 | 5 new columns + enum + index on `orden_servicio` | `src/shared/db/schema.ts:351-375` — `vehiculoId` NOT NULL FK, `ordenCategoriaEnum` (5 values), 3 nullable text cols, `orden_vehiculo_created_idx` — exact match |
| 1.3 | migration 0015 generated, not `--custom` | `0015_order_vehiculo_category_notes.sql` — CREATE TYPE, ADD COLUMN×5, ADD CONSTRAINT (FK RESTRICT), CREATE INDEX — matches design.md D5 verbatim |
| 1.4 | structural NOT NULL/FK/index/enum tests | `schema.test.ts:231-251` — `vehiculo_id` notNull+FK assertion, `categoria` notNull+no-default assertion, index columns assertion — present |
| 1.6 | `createOrder` ownership check + `InvalidVehiculoError`, `categoria` required | `service.ts:182-202` — `ownsVehicle` check against `clienteDetail.vehicles` (active only), `InvalidVehiculoError`, `isServiceCategory`/`InvalidCategoriaError` guard also present (task 2.9, layered on top) |
| 1.7/2.9 | route maps errors → 400 | `route.ts` (POST) — `InvalidCategoriaError`/`InvalidVehiculoError` → `{errors}` 400; PATCH route → `isServiceCategory` guard → 400 |
| 1.8 | `hallazgos` never reaches insert | `service.ts:210-217` `.values({...})` map lists exactly `clienteId, vehiculoId, categoria, description, appointmentAt, createdBy` — no note fields — confirmed |
| 1.9/1.10 | SEAM filled inside `tx`, above DELETE | `vehicles.ts:269-287` — verbatim match to design.md D4's code block; `vehicles.test.ts:306-360` has dedicated `SEAM: permanent delete refused…` describe block with a "select uncalled for deactivate-only" case |
| 1.11 | `GET /api/customers/[id]/vehicles`, active-only, `customers.read` | `route.ts` present, calls `listVehiculosByCliente(id)` (no `includeInactive`), gated via `can(user, "customers.read")`; registered in `ROUTE_GUARDS` |
| 1.13 | native `<select>`, submit gate `!vehiculoId` | `ServiceOrderForm.tsx:560` — `disabled={isSubmitting \|\| (!isEdit && (!vehiculoId \|\| !categoria))}` — matches (categoria folded in by 2.4) |
| 2.1 | `categories.ts` exports `ServiceCategory`+`CATEGORIA_LABEL`, all 5 enum values | `categories.ts` — exact 5-key map, `isServiceCategory` guard present (2.9 addition, correctly layered) |
| 2.3 | PATCH whitelists `description`/`appointmentAt`/`categoria`/3 notes | `route.ts` (PATCH) — `NULLABLE_TEXT_FIELDS` = exactly those 4, plus explicit `appointmentAt` and `categoria` blocks — matches |
| 2.5 | order detail: vehicle Link, `CATEGORIA_LABEL`, `\|\| "—"` on 3 notes (not `??`) | `service-orders/[id]/page.tsx:135-154` — Link to `/customers/${clienteId}/vehicles/${vehiculo.id}`, `CATEGORIA_LABEL[orden.categoria]`, `orden.hallazgos \|\| "—"` etc. — matches exactly, including the `\|\|`-not-`??` claim |
| 2.5b | closed by 3.2 | vehicle-detail page now exists at exactly the linked path — confirmed, no dangling 404 |
| 2.10 | `toDatetimeLocal` local getters, PATCH omits untouched `appointmentAt` | `ServiceOrderForm.tsx:56-62` builds from `getFullYear/getMonth/getDate/getHours/getMinutes` (local, not UTC) — matches |
| 3.1 | `listOrdenesByVehiculo`, `desc(createdAt)`, `queryFn` seam | `queries.ts:58-`  present, mirrors existing seam shape |
| 3.2 | vehicle detail page, `getClienteById`+`.find`+`notFound()`, route-guards entry | `vehicles/[vehicleId]/page.tsx` — exact structure; `route-guards.test.ts:56` — `"/customers/[id]/vehicles/[vehicleId]": { GET: "customers.read" }` present |
| 3.3 | both vehicle cards become links, weight distinction preserved | `customers/[id]/page.tsx:123-152` — both `<Link>`, `CARD_MUTED` vs `CARD` unchanged |
| 3.4 | two-vehicle history scoping e2e | `full-flow.e2e.test.ts:785` — present, real Postgres |
| 3.12 | `datetime.ts` `formatDateTime`/`formatDate`, es-PA + America/Panama, 12 call sites | `datetime.ts` present exactly as described; `datetime.test.ts` pins locale+zone with `TZ` forced per-case |
| 3.14 | hover fix — both cards darken now | `customers/[id]/page.tsx:133` `hover:bg-muted-foreground/10` (was `hover:bg-muted/70`, which lightened) — confirmed fixed |

**No overstated or stale claim was found among the audited tasks.** The tasks.md is unusually well-corroborated by the actual diff — every code claim I checked resolved to the exact line/behavior described.

### Follow-Up Re-Check (still open — confirmed still true in code, not silently fixed or silently gone)
| # | Claim | Still true? |
|---|---|---|
| 1.18 | `createOrder`'s insert map passes `createdBy` straight from body, no auth check | ✅ still true — `service.ts:216` `createdBy: input.createdBy ?? null`, no validation |
| 1.19 | `GET /api/customers/[id]/vehicles` types body `Vehiculo[]` but dates cross wire as ISO strings | ✅ still true — `ServiceOrderForm.tsx:167` `.then((body: { vehicles: Vehiculo[] })` — `Vehiculo.createdAt`/`deactivatedAt` are `Date` in the type but the route returns `NextResponse.json({vehicles})`, serialising them to strings |
| 2.11 | `POST /api/service-orders` text fields (`description`, `appointmentAt`) still unguarded — only `categoria` hardened | ✅ still true — `route.ts` (POST) has no length/type guard on `description`/`appointmentAt`; only `InvalidCategoriaError`/`InvalidVehiculoError` are caught. PATCH's `NULLABLE_TEXT_FIELDS`+`MAX_TEXT_LENGTH`+date-parse guard have no POST-side counterpart |
| 2.12 | `categoria` has no error slot, not in `RENDERED_ERROR_FIELDS` | ✅ still true — `ServiceOrderForm.tsx:78` `RENDERED_ERROR_FIELDS = new Set(["clienteId", "vehiculoId", "form"])` — `categoria` absent |
| 3.10 | `customers/[id]/page.tsx` still renders English permission string | ✅ still true — `customers/[id]/page.tsx:53` `"You do not have permission to view this page."` (the sibling vehicle-detail page at `vehicles/[vehicleId]/page.tsx:44` correctly uses the Spanish string) |
| 3.11 | order-history table duplicated between `customers/[id]/page.tsx` and `vehicles/[vehicleId]/page.tsx` | ✅ still true — both files have their own `<Table>`/`<TableHeader>`/`StatusBadge` markup, not extracted |
| 3.13 | two unbounded reads: `listOrdenesByVehiculo` (no `limit`) and `getClienteById`'s full `detail.orders` (unused by the vehicle page) | ✅ still true — `queries.ts:58` `ponytail:` comment confirms no limit; `vehicles/[vehicleId]/page.tsx` never reads `detail.orders`, only `detail.vehicles`/`detail.cliente` |
| 3.15 | `datetime.test.ts`'s 4-zone `it.each` all assert the same string | ✅ still true — `datetime.test.ts:24-30` — UTC/Madrid/Tokyo/Panama all assert `.toContain("9:00")`; only `formatDate`'s Tokyo case is genuinely distinct |

All 8 follow-ups are confirmed real and unresolved — none was silently fixed, and none has quietly vanished from the code the note describes.

### Spec Compliance Matrix

**service-orders** (`specs/service-orders/spec.md`)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Service Order Creation with Parts (R20) | active vehicle + categoria + no parts → open, referencing both | `service.test.ts` (createOrder suite) | ✅ COMPLIANT |
| R20 | producto line item recorded w/ snapshot+qty | `service.test.ts` (pre-existing, unchanged) | ✅ COMPLIANT |
| R20 | unknown clienteId → reject | `service.test.ts` (`UnknownClienteError`, pre-existing) | ✅ COMPLIANT |
| R20 | duplicate producto on same order → merge or 2nd line, never silently dropped | `service.test.ts` (pre-existing) | ✅ COMPLIANT |
| R20 | nonexistent `vehiculoId` → Spanish 400, no order | `service.test.ts` (task 1.5, "rejects unknown vehicle") | ✅ COMPLIANT |
| R20 | vehicle of customer B, order for customer A → reject | `service.test.ts` (task 1.5, "customer-B's vehicle") | ✅ COMPLIANT |
| R20 | zero active vehicles → picker offers none, submit blocked, directive message | `ServiceOrderForm.test.tsx` (task 1.12/1.13) | ✅ COMPLIANT |
| Service Category Vocabulary | selector shows all 5 incl. REVISADO, no distinct treatment | `categories.test.ts` + `ServiceOrderForm.test.tsx` | ✅ COMPLIANT |
| Service Category Vocabulary | out-of-enum categoria rejected | `categories.test.ts` (`isServiceCategory`) + `route.test.ts` POST/PATCH (task 2.9) | ✅ COMPLIANT |
| Category and Completion Notes Editing | patch 3 notes on order w/ none | `service.test.ts` (task 2.2) | ✅ COMPLIANT |
| Category/Notes Editing | patch categoria only, other fields untouched | `service.test.ts` (task 2.2) | ✅ COMPLIANT |
| Category/Notes Editing | create payload w/ `hallazgos` → ignored, not stored | `service.test.ts` (task 1.8, pins the `.values()` whitelist) | ✅ COMPLIANT |
| Order Detail Displays Vehicle/Category/Notes | vehicle plate as link + categoria as text | *(none — `page.tsx`, zero coverage)* | ❌ **UNTESTED** |
| Order Detail Displays… | unset note field → placeholder, never blank row | *(none — `page.tsx`, zero coverage)* | ❌ **UNTESTED** |
| Order Detail Displays… | deactivated vehicle's order detail still shows identity+link | *(none — `page.tsx`, zero coverage)* | ❌ **UNTESTED** |

**customer-management** (`specs/customer-management/spec.md`)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Vehicle Collection Persistence… | add 2nd vehicle, 1st untouched, one tx | `vehicles.test.ts`/`customers/service.test.ts` (pre-existing C3) | ✅ COMPLIANT |
| …Persistence | edit 1 of 2, other + cliente fields untouched | pre-existing C3 suite | ✅ COMPLIANT |
| …Persistence | soft-delete sets `deactivatedAt`, row survives, excluded from list/search/picker | pre-existing C3 suite | ✅ COMPLIANT |
| …Persistence | restore clears `deactivatedAt`, fields intact | pre-existing C3 suite | ✅ COMPLIANT |
| …Persistence | patch w/ no `vehicles` key → all rows untouched | pre-existing C3 suite | ✅ COMPLIANT |
| …Persistence | pre-migration inline fields → exactly 1 `vehiculo` row | migration-era test (C3, out of C4 scope, unchanged) | ✅ COMPLIANT |
| …Persistence | `tecnico` permanent-delete → 403 before DB work | `vehicles.test.ts`/policy tests (pre-existing) | ✅ COMPLIANT |
| …Persistence | `administrador` delete, zero history → row physically removed | `vehicles.test.ts` (pre-existing) | ✅ COMPLIANT |
| …Persistence | vehicle w/ ≥1 `orden_servicio` row → `administrador` delete refused, Spanish 400 under `vehicles` | `vehicles.test.ts` SEAM describe (task 1.9) **+ e2e** `full-flow.e2e.test.ts:726` (`patchVehiclesRaw`, real Postgres) | ✅ COMPLIANT |
| …Persistence | same vehicle w/ history → soft-delete still succeeds, history intact | e2e `full-flow.e2e.test.ts:739` | ✅ COMPLIANT |
| Vehicle Detail Screen | click vehicle card → navigate to detail | *(none — `page.tsx` Link, zero coverage)* | ❌ **UNTESTED** |
| Vehicle Detail Screen | two vehicles, each w/ orders → history scoped to queried vehicle only | e2e `full-flow.e2e.test.ts:785` | ✅ COMPLIANT |
| Vehicle Detail Screen | click history row's "Ver" → `/service-orders/[id]` | *(none — `page.tsx` Link, zero coverage)* | ❌ **UNTESTED** |
| Vehicle Detail Screen | zero orders → empty-state message | *(none — `page.tsx`, zero coverage)* | ❌ **UNTESTED** |
| Vehicle Detail Screen | deactivated vehicle, direct nav → identity+history still render | Data dependency (`getClienteById` `includeInactive:true`) covered by pre-existing C3 tests; the PAGE'S rendering of that data is **UNTESTED** | ⚠️ **PARTIAL** (data path proven, render path not) |

**Compliance summary**: 23/30 scenarios COMPLIANT with a passing runtime test, 6 UNTESTED, 1 PARTIAL. **All 7 gaps are `page.tsx`-rendering scenarios** — this repo has zero automated tests for any Next.js Server Component page (a pre-existing, repo-wide convention, not something C4 introduced), and every one of those scenarios is implemented correctly by direct source read (verified above), just not runtime-proven. This is exactly the gap tasks.md's own 3.2/2.5 notes name plainly rather than paper over.

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|---|---|---|
| `vehiculo_id` FK NOT NULL RESTRICT | ✅ Implemented | schema.ts + migration 0015, e2e-proven |
| `categoria` enum, 5 values, REVISADO included | ✅ Implemented | `orden_categoria` pgEnum, unaccented slugs per D3 |
| SEAM (permanent-delete refusal) | ✅ Implemented | `vehicles.ts:269-287`, unit + e2e |
| `createOrder`/`updateOrder` vehicle+category validation | ✅ Implemented | ownership check + `isServiceCategory` guard, both write paths (categoria only; text fields on PATCH only, see follow-up 2.11) |
| Vehicle detail route | ✅ Implemented | nested route, ownership-free-404 via `.find()`, route-guard registered |
| Order detail vehicle/category/notes rows | ✅ Implemented | page code correct; render-level untested (see above) |

### Coherence (Design)
| Decision | Followed? | Notes |
|---|---|---|
| D1 — read placement (3-way split) | ✅ Yes | `listOrdenesByVehiculo` in `service-orders/queries.ts`; SEAM inline in `customers/vehicles.ts` on `tx`; vehicle identity via existing `listVehiculosByCliente` — no new module edge |
| D2 — fetch-on-customer-change, clear in same handler, `cancelled` guard | ✅ Yes | `ServiceOrderForm.tsx:158-178`, `setVehiculoId("")` in the sync `handleCustomerSelect` |
| D3 — unaccented Spanish slugs (`roleEnum` precedent) | ✅ Yes | `ordenCategoriaEnum` — `instalacion`/`mant_preventivo`/`mant_correctivo`/`reparacion`/`revisado` |
| D4 — SEAM exact code, inside `tx`, above DELETE | ✅ Yes | verbatim match, `vehicles.ts:269-287` |
| D5 — plain `drizzle-kit generate`, no default on `categoria` | ✅ Yes | migration 0015 confirms both |
| D6 — nested route, 2 reads, no `getVehiculoById` | ✅ Yes | `vehicles/[vehicleId]/page.tsx` matches the design's data-flow diagram exactly |
| **Deviation**: native `<select>` over base-ui `Select` (tasks 1.13, 2.4) | ✅ **Recorded** | tasks.md 1.13: "no existing test/shim exercises it in jsdom" — explicit, reasoned |
| **Deviation**: `\|\| "—"` instead of `??` on the 3 note rows (task 2.5) | ✅ **Recorded** | tasks.md 2.5: "`field()` bails on `""` as well as null (GGA round 2)" — explicit, reasoned, and does not contradict the spec's "explicit empty-state placeholder" wording |
| Open Question in design.md ("—" placeholder for `field()`'s `null` vs empty row contradiction) | ✅ Resolved | tasks.md 2.5 implements exactly the design's own "Planned resolution" |

### Issues Found

**CRITICAL**:
1. 7 spec scenarios have **no covering test that passed at runtime** (strict per-scenario compliance rule): order-detail vehicle/category/notes rendering ×3 (`service-orders/[id]/page.tsx`), vehicle-detail-screen navigation/empty-state ×3 and deactivated-vehicle render ×1 (`customers/[id]/page.tsx` link + `vehicles/[vehicleId]/page.tsx`). Each is implemented correctly by direct source read (see Task-Claim Audit and Correctness tables) — this is a coverage gap, not a functional defect — but per this verify phase's own compliance rule ("a spec scenario is compliant only when a covering test passed at runtime"), an implemented-but-unproven scenario is CRITICAL, full stop, regardless of how confident the source read is. No AGENTS.md or other project config formally sanctions skipping `page.tsx` coverage — it is an emergent, unwritten convention (repeated in tasks.md's own notes across WU2 and WU3), not a documented exception, so it does not qualify for the "project config explicitly allows manual verification" carve-out.

**WARNING**:
1. 8 open follow-ups (1.18, 1.19, 2.11, 2.12, 3.10, 3.11, 3.13, 3.15) are all confirmed still-present, deliberately-scoped-out gaps — see Follow-Up Re-Check table. None is a surprise; all are correctly labelled as such in tasks.md. Not blocking in themselves — recorded technical debt, not silently dropped work.
2. `npm run lint` (0 errors / 15 warnings) and the e2e suite (31/31) were **not independently re-run** in this verify session — both are taken as reported evidence per the launch instructions, cross-checked only by confirming the claimed e2e test bodies exist and assert what they claim to.

**SUGGESTION**: None beyond what tasks.md's own follow-ups already capture.

### Verdict
**FAIL** — 0 build/test-command failures (tsc and `npm test` both independently re-run clean: 1060/1060, 0 type errors), and every one of the 47 tasks is either done-and-verified or open-and-honestly-labelled as an out-of-scope follow-up. The sole reason this is not PASS: 7 of 30 spec scenarios (all `page.tsx` rendering scenarios — order-detail vehicle/category/notes, vehicle-detail-screen navigation/empty-state/deactivated-render) have zero runtime-executed coverage, which this phase's own compliance rule treats as CRITICAL regardless of how well the source matches the spec by inspection. **This is a pre-existing, repo-wide gap** (this codebase has never had a single `page.tsx` test, across every prior change, not something C4 introduced) rather than a regression — the orchestrator/owner should decide whether to accept this as a standing, documented exception (at which point a re-verify would read PASS WITH WARNINGS) or require `page.tsx`-level coverage (e2e or integration) before archiving.
