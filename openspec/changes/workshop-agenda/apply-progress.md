# Apply progress: workshop-agenda

Mode: Strict TDD. Store: hybrid. Delivery: auto-chain, feature-branch-chain. Branch: `feat/workshop-agenda-wu1` (WU1 and WU2 files, split into two commits by file).

## WU1: access, nav, stub, date helpers (tasks 1.1-1.9 done; 1.10 closing steps left to the orchestrator)

Files (vs `feat/workshop-agenda`, changed lines, 395 total, budget 400):
- `src/modules/auth/policy.ts` (6), `policy.test.ts` (9), `route-guards.test.ts` (2)
- `src/modules/layout/nav-items.ts` (3), `nav-items.test.ts` (21)
- `src/components/app-sidebar.tsx` (3), `app-sidebar.test.tsx` (19)
- `src/app/(app)/agenda/page.tsx` (18, new), `page.test.tsx` (41, new)
- `src/modules/agenda/dates.ts` (122, new), `dates.test.ts` (151, new)

TDD evidence: every test file was written first and run RED before production code (9 failures in the auth/layout/sidebar files, "Cannot find module" for `dates` and `page`); GREEN after.

Mutation-verify (revert, named test red, restored from a per-file backup):

| Mutation | Test that went red |
|---|---|
| tecnico `agenda.manage: true` (policy.ts) | "Matrix row per role: agenda.manage ..." and "grants only the allowed actions to tecnico" |
| pantalla `agenda.manage: true` | "Matrix row per role ..." and "Matrix row: pantalla is true for board.customer ..." |
| delete `ROUTE_GUARDS["/agenda"]` | "every existing API route and page has a ROUTE_GUARDS entry", "every Action with a route in v1 is reachable" |
| page `can()` replaced by `if (false)` | "Técnico is denied ...", "Pantalla never sees the agenda ...", route-guards "every non-session-only registry entry's declared Action appears as a can(user, ...) call" |
| nav action `agenda.manage` -> `board.read` | "Nav link by role: Agenda ..." |
| remove `agenda: CalendarDays` from the icon map | "renders the `agenda` key as CalendarDays ..." |
| `weekStart` without the `+6` shift | "Week starts Monday ...", "rolls over the year in the week view", "month covers every drawn week ...", "monthGrid is Monday-first ..." |
| `<=` in `isOverdue` | "Margin boundary: false at 59 and exactly 60 minutes, true at 61" |
| today = UTC day | "Defaults: no params resolve to week and the Panama day ..." (and the invalid-param cases) |
| drop `hourCycle: "h23"` | "formats 2026-10-26T19:05:00Z as 14:05 ...", "midnight reads 00:00 ..." |

Note: `formatAgendaTime` uses locale `en-US` with `hourCycle: "h23"`, not `en-GB` as `board/format.ts`. With `en-GB` the `h23` option is the locale default, so dropping it would not fail any test (a placebo mutation). With `en-US` the option is load-bearing and the mutation is red.

Gates: `npm test` 237 files / 3738 tests passed (after WU2 was also in); `npx tsc --noEmit` clean; `npm run lint` 0 errors / 13 warnings. WU1 focused command alone: 9 files, all green.

Deviations from the task text:
- 1.4 "no agenda query seam called" is not asserted: `agenda/queries.ts` is a WU2 file, so the WU1 page has no seam to mock. WU3 adds that assertion with the wiring.
- Existing assertions updated for the new nav entry: "admin sees 13 total items" (was 12), the admin CRM order list, and the policy fixtures (`adminGrants`, `tecnicoGrants`; jefe inherits by spread, pantalla by `Object.fromEntries`).
- `dates.ts` exports `stepDate(view, key, direction)` and `monthGrid(key)` returns `string[][]` (rows of seven day keys). `OVERDUE_MARGIN_MINUTES = 60` per spec (D4 said `_MS`). "Today" is computed by shifting the instant by the fixed UTC-5 offset (no `Intl`, no zone lookup).
- Month step clamps the day of month (2026-01-31 + 1 month = 2026-02-28).

Unverified: sidebar icon and `PermissionDenied` render were checked in jsdom only; nothing was opened in a browser (WU9). The `/agenda` route-guards entry is exercised by the file-text tests, not by a request.

## WU2: range and overdue queries (tasks 2.1-2.4 done; 2.5 closing steps left to the orchestrator)

Files (vs `feat/workshop-agenda`, new files, 367 lines; production + unit 120, e2e 247 in its own file):
- `src/modules/agenda/queries.ts` (73)
- `src/modules/agenda/queries.test.ts` (47)
- `src/e2e/agenda-queries.e2e.test.ts` (247)

API: `agendaRange(scope, {from,to}, cap = 500) -> {rows, truncated}`; `agendaOverdue(scope, now, cap = 500) -> {rows, truncated, total}` where `total` is drizzle `count()` over the same predicate (a number; asserted with `typeof`). Rows: `{id, status, appointmentAt: Date | null, customerName, customerPhone, vehiclePlate: string | null}`. `appointmentAt` stays `Date | null` because the column is nullable and both predicates only admit non-null rows; WU3's `toAgendaItem` must narrow it.

TDD evidence: `queries.test.ts` RED ("Cannot find module './queries'") then GREEN. The e2e file was written after `queries.ts` (no separate RED run); its value is shown by the mutations below, each of which went red.

Mutation-verify (e2e unless noted; DB `dforce_e2e`, `TZ=UTC`, session zone forced to UTC and asserted):

| Mutation | Test that went red |
|---|---|
| `panamaMidnight` bound spelled `Z` instead of `-05:00` (dates.ts) | "Panama midnight boundary ...", "Month range covers the drawn weeks ..." |
| `lt` -> `lte` on the upper bound | "Panama midnight boundary ...", "Month range covers the drawn weeks ..." |
| drop `ne(status, "cancelled")` | "Status visibility ..." (and unit "excludes cancelled orders from the range") |
| vehicle left join -> inner join | "Chip data: ... a no-vehicle order has a null plate ..." |
| `.limit(cap + 1)` -> `.limit(cap)` | "Row cap is disclosed ..." |
| overdue `lt` -> `lte` | "Margin boundary in SQL ..." |
| drop `scope.where` from the range | "Scope: a técnico sees only the orders assigned ..." |
| drop `scope.where` from the overdue predicate | "Scope: ..." |
| `count()` -> raw `sql count(*)` | "Overdue total is a number, not a string ..." and "Scope: ..." |
| unit: append `AT TIME ZONE` text to queries.ts | "binds instants and never does zone logic ..." |
| unit: remove a `scope.where` | "applies the caller's scope ..." |

Finding: deleting `.limit(cap + 1)` outright is NOT caught and not a correctness bug (`rows.slice(0, cap)` plus `rows.length > cap` still yields 500 + truncated); it only loses the DB-side bound. The `limit(cap)` mutation is the one that matters and is covered.

Zone proof: the e2e file passes with `TZ=UTC` and `TZ=Pacific/Auckland`; the pooled connections get `SET TIME ZONE 'UTC'` and `SHOW timezone` is asserted.

Gates (final tree, WU1 + WU2): `npm test` 237 files / 3738 passed; `npx tsc --noEmit` clean; `npm run lint` 0 errors / 13 warnings. Full e2e on a recreated `dforce_e2e` (`TZ=UTC npm run test:e2e`): 27 files / 348 tests passed, 0 skipped. `dforce_catalog` and `dforce_catalog_wu4` untouched.

Unverified: `typeof total === "number"` and the types of `AgendaRow` are checked by e2e and tsc against the real select; the arity/`expectTypeOf` half of "scope required" is compile-time only (`tsc --noEmit` covers test files; vitest does not typecheck). Not measured: query plan or speed at volume (no index was added; follow-up in tasks.md).
