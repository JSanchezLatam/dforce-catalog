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

## WU6: booking dialog (branch `feat/workshop-agenda-wu6`, off `feat/workshop-agenda-wu5-e2e`)

Tasks 6.1-6.4 done; 6.5 (GGA, PR) left to the orchestrator. Nothing committed.

Files: new `agenda/AgendaBookingForm.tsx` (+ `.test.tsx`), `src/e2e/agenda-booking.e2e.test.ts`; edited `AgendaHeader`, `DayView`, `WeekView`, `MonthView` (+ their tests) and `app/(app)/agenda/page.tsx` (passes `date` to `DayView`).

Behaviour: `AgendaBookingForm({day, triggerLabel, triggerClassName, ariaLabel})` is a `"use client"` controlled Dialog with its trigger; the body (`BookingFields`, which holds `useRouter`/`useToast`) mounts only while open, so every opening starts clean and the 40-odd month cells cost one button each, with no wrapper/provider needed by the existing view tests. No `typeof document` guard, no portal of its own. `DayBooking` is the per-day "+" (aria-label `Agendar cita el DD/MM`, `min-h-11 min-w-11`) used in DayView (only when `date` is given, so CombinedView is unchanged), WeekView columns and MonthView cells; the header button "Agendar cita" defaults to the selected `date`. POST body: `{clienteId, status:"booked", appointmentAt:\`${day}T${time}:00-05:00\`, description: trimmed or null}`; the route accepts a null description and omits vehicle/category. `CustomerPicker` untouched, `canCreateCustomer={false}` (WU7 adds the create form). Required checks "Elegí un cliente" / "Elegí el día" / "Elegí la hora"; 409 `cliente_deactivated` -> "Ese cliente está desactivado. Elegí otro."; `unknown_cliente` -> "Seleccioná un cliente válido"; 400 shows the first `errors` value; network -> `CONNECTION_ERROR`. Success: close, `addToast("success","Cita agendada")`, `router.refresh()`, below the try/catch.

TDD: unit tests written first, run RED (missing module; 4 trigger tests red on the views) before the code. The e2e was written after the code.

Mutation-verify (single file backed up and restored each time; final `git diff` holds only WU6 changes):

| Mutation | Test that went red |
|---|---|
| `appointmentAt` via `new Date(...).toISOString()` (TZ = Pacific/Auckland) | "Request body: exactly clienteId, booked, the -05:00 instant ..." |
| remove the required-field check | the three "Required fields: a missing customer / day / time ..." |
| `router.refresh()` before `addToast` | "Success feedback: closes, toasts once, and the toast is added above refresh even when refresh throws" (a first attempt with `sd` did not match and was a no-op; redone with a script) |
| drop `disabled={isSubmitting}` on submit | "In flight: the submit is disabled until the response lands" |

Gates: `npm test` 246 files / 3821 passed; `npx tsc --noEmit` clean; `npm run lint` 0 errors / 13 warnings. Full e2e on a recreated `dforce_e2e`: 29 files / 355 passed. `dforce_catalog` and `dforce_catalog_wu4` untouched.

Lines vs `feat/workshop-agenda-wu5-e2e` (tracked diff +58/-11, plus untracked): production 128 (form) + 14 edits; unit tests 174 (form) + 37 in the view tests; about 360 added in total, e2e 74 in its own file.

Unverified: no browser or LAN-IP check (dialog look, 44px, focus handling inside the base-ui Dialog, the "+" placement in cells and columns) - WU9; the e2e was not mutation-verified (reminder window, history row); description is a single-line input, not the order form's textarea; `Date` zone test relies on `process.env.TZ` taking effect at runtime in Node.

## WU7: quick customer create (branch `feat/workshop-agenda-wu7`, off `feat/workshop-agenda-wu6-e2e`)

Tasks 7.1-7.5 done; 7.6 (GGA, PR) left to the orchestrator. Nothing committed.

Files: new `agenda/CustomerQuickForm.tsx` (+ `.test.tsx`), `src/e2e/agenda-quick-customer.e2e.test.ts`; edited `service-orders/CustomerPicker.tsx` (+ test, two tests appended, existing ones untouched), `agenda/AgendaBookingForm.tsx` (+ test, three tests appended).

Behaviour: `CustomerPicker` gets an optional `renderCreate(select)`; absent = the `CustomerForm` branch exactly as before, present = it replaces that branch (called from a tiny `RenderSlot` component, because calling it during the picker's render tripped the React-compiler "refs during render" lint). `CustomerQuickForm({canWrite, onSaved})`: name + phone, POST `{name, phone}` (+ `allowDuplicatePhone: true` on "Guardar igual"); 400 errors inline per field; 403/other -> form-level line; 201 -> toast "Cliente creado" (below the try/catch) then `onSaved({...cliente, plates: []})`. 409 `duplicate_phone` replaces the create button with "Ver el cliente existente" / "Usar ese cliente" / "Guardar igual" (all `busy`-disabled); editing the phone disarms them. Nesting: `AgendaBookingForm` portals the quick form into a `<div>` that is a DOM sibling of the booking `<form>` (callback-ref state, so no `document` guard); the submit handler also does `preventDefault` + `stopPropagation` because React bubbles through the portal. `canCreateCustomer` prop on `AgendaBookingForm` defaults to true.

Finding on the deactivated lookup: `findClienteByPhone` has no `deactivatedAt` filter, so POST answers 409 `duplicate_phone` for a deactivated customer; but `GET /api/customers` defaults to `status=active` and the list item carries `deactivatedAt` only for `inactive`/`all`. With the default URL a deactivated match is never returned, so the spec's "lookup shows deactivated" could not occur. The lookup therefore adds `&status=all` (`?search=<normalizePhone(phone)>&pageSize=50&status=all`, a deviation from the URL in task 7.2/D11, which relied on the default hiding it): the match is found, `deactivatedAt` is non-null, "Usar ese cliente" is disabled with "Ese cliente está desactivado y no se puede usar para una cita. Podés guardar igual para crear uno nuevo." If the id is not in the result (should not happen), the same disabled button with "No se encontró al cliente existente para usarlo.". "Usar ese cliente" without a prior "Ver" does the lookup first, then selects only an active match. e2e proves: deactivated phone still 409s, default list hides it, `status=all` shows it with `deactivatedAt`, `allowDuplicatePhone` creates (201).

TDD: picker, quick-form and booking tests written first and run RED (render-prop missing; module missing; 3 booking tests red) before the code. The e2e was written after the code.

Mutation-verify (one file backed up and restored each time):

| Mutation | Test that went red |
|---|---|
| drop `event.stopPropagation()` in the quick form | "Nested submit does not submit the booking: Enter in a quick-form field posts the customer and never the order" (first version of that test was a PLACEBO under this mutation: with no customer picked, a leaked submit stops at the booking's own validation and posts nothing; added the `Elegí un cliente` absence assertion, then it went red) |
| render the quick form inline (no portal) | "Nested submit: the quick form is not a DOM descendant of the booking form" |
| drop `allowDuplicatePhone` from the re-POST | "Guardar igual resubmits with allowDuplicatePhone: true" |
| enable "Usar ese cliente" when deactivated | "Deactivated duplicate cannot be reused: Usar ese cliente is disabled with the note, Guardar igual stays enabled" (+ the "without looking first" one) |
| select a deactivated match | "Usar ese cliente without looking first does the lookup, and a deactivated match is not selected" |
| render `CustomerForm` branch even with `renderCreate` | "With renderCreate it replaces that branch and the callback selects the customer" |

Not mutation-verified: the e2e file, "Create requires customers.write", the 400/connection tests.

Gates: `npm test` 247 files / 3839 passed; `npx tsc --noEmit` clean; `npm run lint` 0 errors / 13 warnings. Full e2e on a recreated `dforce_e2e`: 30 files / 358 passed. `dforce_catalog` and `dforce_catalog_wu4` untouched.

Lines vs `feat/workshop-agenda-wu6-e2e` (tracked +140/-6, plus untracked): production 173 (quick form) + about 33 in picker and booking form = ~206; unit tests 205 (quick form) + 73 (booking) + 33 (picker) = 311; e2e 81 in its own file. Production + unit tests ~517, OVER the 400 budget; 7.4 is already its own file/sub-PR candidate per 7.6.

Unverified: no browser or LAN-IP check (the quick form sits in the DOM BELOW the booking footer, as a sibling of the form, so its placement and the dialog's scroll/focus-trap behaviour with the portalled target are unseen; 44px classes only); `canCreateCustomer` is not plumbed from the page (defaults true; both `agenda.manage` roles hold `customers.write`; the server still 403s); the `Cliente seleccionado` picker row for a just-created customer shows no plate by design (plates: []).

## WU8 - Reprogramar, No se presentó, expectedStatus guard (branch `feat/workshop-agenda-wu8`, off `feat/workshop-agenda-wu7-e2e`; nothing committed)

Tasks 8.1-8.7 done; 8.8 (GGA, PR) left to the orchestrator. Deviation: 8.1 lives in `service-orders/service.test.ts` (the `transitionOrder` describe), not `set-status.test.ts`, which tests `setStatus` only.

Files. SERVER half: `service-orders/service.ts` (`StaleOrderStatusError`, optional `expectedStatus` compared right after `lockOrderForMutation`, before any validation or write), `api/service-orders/[id]/route.ts` (validate, pass through, 409 `{ error: "stale_status", message }` above the `OrderTransitionError` branch; invalid value -> 400 `{ errors: { expectedStatus: "Estado esperado inválido" } }`), their two test files, and `src/e2e/agenda-actions.e2e.test.ts`. CLIENT half: `agenda/patchOrder.ts` (shared fetch + error-text resolution), `ReprogramDialog.tsx`, `NoShowConfirm.tsx`, `ItemActions.tsx`, the edits to `DayView`/`WeekView`/`MonthView` (CombinedView reuses DayView) and `(app)/agenda/page.tsx` (fills the `VencidasPanel` `actions` slot), plus `ReprogramDialog.test.tsx`, `NoShowConfirm.test.tsx`, `ItemActions.test.tsx`. The two halves share no file, so the server half can ship first.

Tests. Server: 3 service tests ("Stale no-show is refused...", "proceeds when expectedStatus matches...", "Transitions without expectedStatus are unchanged...") + 4 route cases (pass-through, 409 stale_status, 400 x4 invalid values, absent unchanged). Server tests were written RED first (service stale case failed by name). Client component tests were written AFTER the components (not a true RED); their meaning was established by the mutations below. e2e: 4 cases (reschedule replans, ordinary cancel with one booked->cancelled row, stale 409 with nothing written, unguarded cancel still works).

Mutation-verify (one file each, restored from a backup; final `git diff` holds no mutation, confirmed by the green suites after): drop the comparison -> "Stale no-show is refused" unit red AND e2e "Stale no-show is refused" red; comparison moved after the write -> unit red (the e2e stays green on that one: a throw inside the transaction rolls the write back, so only the unit test pins "before any write"); `expectedStatus !== order.status` without the undefined guard -> the existing transition tests plus "Transitions without expectedStatus are unchanged" red; route 409 -> 400 -> "answers a stale expectedStatus with 409..." red; NoShowConfirm without `expectedStatus` -> "confirming PATCHes exactly..." red; offer No se presentó without `overdue` -> "Not offered where it does not apply" red; `new Date(...).toISOString()` in ReprogramDialog -> "Request body" red; toast after refresh in each dialog -> both "Success feedback" tests red; confirm fired on mount -> "Confirmation precedes the request" red. Incident: my first mutation script failed to back up (the backup path was a directory), so the mutations stacked; every file was restored by hand and re-verified, then the mutations were re-run cleanly.

Gates: `npm test` 250 files / 3876 passed; `npx tsc --noEmit` clean; `npm run lint` 0 errors / 13 warnings; full e2e on a recreated `dforce_e2e` 31 files / 362 passed.

Lines vs `feat/workshop-agenda-wu7-e2e` (tracked + untracked): production about 227 (server ~20, client ~207); unit tests about 385 (server 75, client ~310); e2e 127 in its own file. Production + unit ~610, over 400: split server-first (service.ts, route.ts, their tests, the e2e file ~95 + 127) then the client.

Unverified: no browser or LAN-IP check (dialog focus/scroll, 44x44 on Reprogramar / No se presentó, the month-cell crowding with up to 3 chips x 2 buttons are 9.x). The e2e "received meanwhile" goes through the real route (vehicle + category, then `status: open`), but the two-tab race itself is sequential, not concurrent. Actions show on every non-muted chip in Day/Week/Month; the Vencida-only rule applies to No se presentó. Role gating is the route's (403 text is shown inline); the buttons render for any role that can open /agenda.

## Fix round (browser checks) (branch `feat/workshop-agenda-fixes`; nothing committed)

Tasks 9.10-9.14 done (WU9 fix tasks). Defects from the LAN-IP checks:

1. Tablet overflow: week/month chips render no action buttons (day view, combined day list and Vencidas panel keep them; the panel is on every view). Chip link `min-w-0`, name/phone/vehicle `[overflow-wrap:anywhere]`. Spec text updated.
2. Header "Agendar cita" primary: new `triggerVariant` prop (default `default`), `DayBooking` passes `ghost`.
3. Booking dialog on phone: footer outside the `<form>` with `form={formId}`; order is fields, quick-form slot, footer; picker wrapper `w-full min-w-0`. `CustomerPicker` untouched.
4. MonthView count: aria-hidden number + `sr-only` text.

Mutation-verify (one file each, restored from an in-memory original; final diff holds none): week/month re-adding `ItemActions` -> the two "Narrow columns" tests red; `aria-label` span back -> "Count is visible text plus sr-only text" red; drop `min-w-0` or the overflow-wrap class -> AgendaChip test red; `triggerVariant` default `ghost` -> header test red; drop `form={formId}` -> "Dialog layout: the submit is tied..." red (plus 11 booking tests that submit); slot after the footer -> same layout test red; drop `w-full min-w-0` -> "picker wrapper can shrink" red.

Existing `ItemActions.test` Week/Month "renders the actions" cases inverted (now DayView and CombinedView).

Gates: `npm test` 251 files / 3886 passed; `npx tsc --noEmit` clean; `npm run lint` 0 errors / 13 warnings. No SQL touched, e2e not run.

Unverified: no browser re-check. 44x44 of the footer buttons, that wrapped chips fit at 768/390, the quick-form slot height on a 390 phone (it is `shrink-0` between form and footer, so a tall quick form still squeezes the scrolling fields), and the `form=` submit across browsers are 9.x browser items.
