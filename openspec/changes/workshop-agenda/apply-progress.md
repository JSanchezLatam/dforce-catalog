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

## WU3: items, header, day and week views, page wiring (tasks 3.1-3.6 and 3.8 done; 3.7 e2e NOT written; 3.9 closing steps left to the orchestrator)

Files (changed lines vs `feat/workshop-agenda-wu2`, untracked included; ~598 total, OVER the 400 budget, about 200 production and 400 tests/fixture):
- New production: `src/modules/agenda/items.ts` (54), `AgendaChip.tsx` (26), `AgendaHeader.tsx` (46), `DayView.tsx` (16), `WeekView.tsx` (34)
- New tests: `items.test.ts` (76), `items.fixture.ts` (18, shared with WU4), `AgendaHeader.test.tsx` (54), `DayView.test.tsx` (58), `WeekView.test.tsx` (51), `agenda-safety.test.ts` (40)
- Modified: `src/modules/agenda/dates.ts` (+6/-3: `panamaToday` renamed and exported as `panamaDay`, new `WEEKDAY_SHORT`), `src/app/(app)/agenda/page.tsx` (wiring), `src/app/(app)/agenda/page.test.tsx` (rewritten around `searchParams`)

TDD: all new test files written first and run RED ("Failed to resolve import" for the missing modules) before the GREEN code. One fixture bug (href not following the id) found by the Overlap test and fixed in the fixture.

Mutation-verify (per-file backup, restored, full agenda suite re-run green afterwards; `git diff` clean of mutations):

| Mutation | Test that went red |
|---|---|
| page: `can()` replaced by `if (false)` | "Técnico is denied: ..." and "Pantalla never sees the agenda ..." |
| sort chips by id only | "Overlap stacks: three 09:00 chips ..." (DayView) and "Overlap stacks: orders by time, then id ..." (items) |
| `description` added to the item | "Chip fields: plain strings for the Panama day ..." |
| chip drops `min-h-11` | "Chip fields: time, name, phone, plate in that order ..." |
| header links drop `min-h-11 min-w-11` | "Hit targets classes: every link is at least 44x44" |
| week grid `grid-cols-7` without `grid-cols-1` | "collapses to a vertical list on phone and seven columns from md" |
| overdue computed as `appointmentAt < now` | "Only booked orders are Vencida ...", "Flag is computed once on the server ..." |
| truncation notice condition inverted | "Row cap disclosure ..." and the page "renders the rows as chips and discloses a truncated range" |
| view switcher uses `today` instead of `date` | "Navigation links: the view switcher keeps the selected date" |
| chip drops the "Vencida" label | "Vencida label ...", "puts each chip under its own day ..." |
| a `"use client"` file with `toLocaleString` | "No client locale date text ..." (safety) |
| a file with `crypto.randomUUID` | "No secure-context APIs ..." (safety) |

Not placebo-checked: a hard-coded extra text node in the chip is not caught (the chip has no description field to render; the guard is the item shape, covered by the `description` mutation above).

Gates (WU3 + WU4 tree): `npm test` 243 files / 3781 tests passed; `npx tsc --noEmit` clean; `npm run lint` 0 errors / 13 warnings (a first run showed 14: an unused `addDays` import in AgendaHeader, removed). No SQL changed, so e2e not re-run.

Deviations and decisions:
- 3.6 says the page does `Promise.all` of range + overdue; the overdue query is NOT called in WU3 because nothing renders its result until the Vencidas panel (WU5). Calling it now is a wasted query per request. WU5 adds it. The per-chip "Vencida" label comes from `isOverdue` in `toAgendaItem`, not from that query.
- `items.ts` has no `description` (task text wins over design D7). `toAgendaItem` throws on a null `appointmentAt` rather than rendering a blank time.
- `sortItems`/`groupByDay` live in `items.ts`; the shared `AgendaChip.tsx` and `items.fixture.ts` are extra files not named in the task (WU4 reuses them).
- `month` and `combined` fall back to the day view in the page switch (as the task says); `month` is replaced by MonthView in WU4.
- Page signature is now `AgendaPage({ searchParams })` (required, Promise); arrays from repeated query keys fall back to week/today and are tested.
- Week view on phone: the same markup, `grid-cols-1` below `md`, so it is a vertical list of seven day sections (empty days show only their header link). Day headers are links to the day view (`min-h-11 min-w-11`).
- Header range label uses digits only (`DD/MM/YYYY`, `Semana del DD/MM/YYYY`, `MM/YYYY`), no month names.

Unverified: 3.7 `src/e2e/agenda-page.e2e.test.ts` (unauthenticated redirect and a real-DB render per role) was not written: the page needs `next/headers` and a real session cookie, there is no existing harness for a page in `src/e2e`, and no SQL changed in this unit. Needs a decision (follow-up or WU9 browser check). 44px targets, phone/tablet layout, hydration and the RSC boundary are class assertions in jsdom only (browser, WU9). The first commit exceeds the 400-line budget by about 200 lines; the production half is about 200, so the overrun is test volume.

## WU4: month view (tasks 4.1-4.3 done; 4.4 closing steps left to the orchestrator)

Files (~145 changed lines vs the WU3 tree):
- New: `src/modules/agenda/MonthView.tsx` (62), `MonthView.test.tsx` (68)
- page hunks that belong to WU4 (everything else in `page.tsx` / `page.test.tsx` is WU3): in `src/app/(app)/agenda/page.tsx` the `import { MonthView } ...` line and the render switch, which is now `view === "month" ? <MonthView/> : view === "week" ? <WeekView/> : <DayView/>` (WU3's version is the single `view === "week" ? <WeekView/> : <DayView/>` line); in `page.test.tsx` the last test, "view=month draws the month grid for the whole drawn range".

TDD: `MonthView.test.tsx` RED (cannot resolve `./MonthView`), then GREEN.

Mutation-verify:

| Mutation | Test that went red |
|---|---|
| `CHIPS_PER_CELL = 4` | "Month cell cap: 5 appointments show the first 3 ..." and "Singular and plural ..." |
| overflow `> 0` to `>= 0` | "Exactly three chips show no overflow link" |
| hidden count off by one | "Month cell cap ...", "Exactly three chips ...", "Singular and plural ..." |
| drop the outside-month dimming | "Outside-month days are dimmed but still carry their chips" |
| drop `aria-current="date"` | "marks today's Panama day" |
| day number and "+N más" lose `min-h-11 min-w-11` | "Hit targets classes ..." |
| chip list loses `max-md:hidden` | "phone: chips collapse to a count below md ..." |
| page: month arm replaced by `false` | page "view=month draws the month grid ..." |

Not caught (cosmetic): removing only the today background classes while keeping `aria-current`.

Gates: see WU3 (single tree run covers both).

Decisions: on a phone (below `md`) each cell shows the day number (a link to the day view, 44x44) and a count (`aria-label` "N citas"/"1 cita"); the chips and the "+N más" link render from `md` up. The grid is 7 columns at every width, with no horizontal page scroll by construction, but chip legibility at 768 px (about 100 px per cell) is unproven. `monthGrid` rows come from WU1's `dates.ts`; the range already covered the drawn weeks.

Unverified: legibility of chips in 100 px cells at 768 px and the 390 px count layout (browser, WU9); no empty-state text in the month grid (the spec only requires it for the day view).

## WU5: in-workshop query, combined view, Vencidas panel (tasks 5.1-5.6 done; 5.7 closing steps left to the orchestrator)

Branch `feat/workshop-agenda-wu5` (off `feat/workshop-agenda-wu3-page`). Nothing staged or committed.

Files (changed lines vs `feat/workshop-agenda-wu3-page`, untracked included; production + unit ~387, e2e 175 in its own file):
- Modified: `queries.ts` (+35: `IN_WORKSHOP_STATUSES`, `WorkshopRow`, `agendaInWorkshop`), `queries.test.ts` (+23/-3), `items.ts` (+22: `WorkshopItem`, `toWorkshopItem`), `items.test.ts` (+36), `items.fixture.ts` (+16: `makeWorkshopItem`), `src/app/(app)/agenda/page.tsx` (+16/-3), `page.test.tsx` (+57/-1)
- New: `CombinedView.tsx` (44), `CombinedView.test.tsx` (56), `VencidasPanel.tsx` (32), `VencidasPanel.test.tsx` (49), `src/e2e/agenda-combined.e2e.test.ts` (175)

Behaviour: `agendaInWorkshop(scope, cap = 500)` lives in `agenda/queries.ts` (board untouched), status list = `BACKLOG_STATUSES` minus `booked`, ordered by `created_at, id`, `limit(cap + 1)`, scope required. The page runs `Promise.all([range, overdue, view === "combined" ? inWorkshop : null])` with one `now`; `VencidasPanel` renders under every view (heading uses the true `total`; list capped, notice when truncated; "Sin citas vencidas" at 0). The panel row shows `DD/MM/YYYY HH:mm` (from `dayKey`/`time`, digits only) above the shared `AgendaChip` (which carries "Vencida" and the order link). Row actions: `VencidasPanel` takes an optional `actions?: (item) => ReactNode` prop, the named slot for WU8; nothing renders there now (tested: no button without it). CombinedView: `grid-cols-1 lg:grid-cols-2`, so side by side from `lg` (1024 px), stacked below (phone and tablet portrait), appointments first.

TDD: all unit test files written first and run RED (5 files failing: missing modules and exports) before production code. The e2e file was written after the code; its value is the mutations below.

Mutation-verify (per-file backup, restored each time; final `git diff` shows only the WU5 changes, no stacked mutations):

| Mutation | Test that went red |
|---|---|
| `IN_WORKSHOP_STATUSES` keeps `booked` | unit "In-workshop set: the five working statuses ..."; e2e "In-workshop set: eight statuses ..." and "Selected day and live orders together ..." |
| drop `scope.where` from `agendaInWorkshop` | unit "applies the caller's scope in the range, the in-workshop read and ..."; e2e "Scope: a técnico reads only the in-workshop orders assigned to them" |
| `.limit(cap + 1)` -> `.limit(cap)` in `agendaInWorkshop` | e2e "Row cap is disclosed: the in-workshop read returns cap rows and truncated ..." |
| drop the `on_hold` guard on the hold label (`toWorkshopItem`) | "Hold reason shown only while on hold: the label for on_hold, none for in_progress" |
| panel heading uses `items.length` instead of `total` | "Count is the true count: the heading shows total, not the rows shown" |
| panel not rendered on `month` | page "Panel on every view: month shows Vencidas (1)" |
| in-workshop read on every view | page "day/week/month does not run the in-workshop read" |
| `lg:grid-cols-2` -> `lg:grid-cols-1` | "Side by side and stacked: one column on phone and tablet portrait, two from lg" |
| `cliente` mentioned in `board/queries.ts` | `queries.privacy.test.ts` "never mentions the cliente table ..." and agenda "the board query file still never names cliente" |
| overdue predicate `status = 'booked'` -> `'open'` | e2e "Count is the true count: three Vencidas ..." |

Gates: `npm test` 245 files / 3806 passed; `npx tsc --noEmit` clean; `npm run lint` 0 errors / 13 warnings. Full e2e on a recreated `dforce_e2e` (`DATABASE_URL=...:5433/dforce_e2e npm run test:e2e`): 28 files / 354 passed, 0 skipped (before a one-line type fix in the e2e file; that file re-run alone: 6/6). `dforce_catalog` and `dforce_catalog_wu4` untouched.

Deviations and findings:
- The DB check `orden_vehiculo_categoria_required` forbids a non-booked order without a vehicle, so an in-workshop row can never be "Sin vehículo" in real data; the code still maps a null plate (spec text) and a unit test covers it, but the e2e cannot seed one.
- Copy not fixed by the spec, chosen here: "Citas del día", "En el taller" (section headings), "Sin órdenes en el taller", "Se muestran las primeras 500 órdenes en el taller.", "Se muestran las primeras 500 citas vencidas.".
- Overdue and in-workshop caps are 500 (spec), not 200 (design D5).
- The overdue read now runs on every request (the WU3 deferral note is resolved).
- Board privacy e2e is an absence test: anchored with `toContain(plate)` and with the agenda read returning the sentinel, but NOT mutation-verified at the route level; the source-text privacy test was.

Unverified: side-by-side from `lg` versus stacked, 44px on the new links and chip legibility are class assertions in jsdom only (browser, WU9); no browser or LAN-IP check; the Vencidas panel look at 390 px is unseen. Query plan and speed at volume not measured.
