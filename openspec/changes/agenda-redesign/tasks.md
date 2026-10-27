# Tasks: agenda-redesign

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~5,400 added + deleted, tests and e2e included, over 20 units (largest 390) |
| 400-line budget risk | High (the design's 6 units of ~300-380 each undercounted tests, e2e and deleted lines; re-forecast below) |
| Chained PRs recommended | Yes |
| Suggested split | WU1 -> WU2 -> ... -> WU19, then WU20 (docs/sign-off) |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

Tracker `feat/agenda-redesign` (draft, off `main`). WU1 PR base = tracker; every later WU base = the previous WU branch. No branch name contains `main`, `master` or `develop`. Only the tracker merges to `main`. Skills: chained-pr `/Users/jorgesanchez/.agents/skills/chained-pr/SKILL.md` (every child PR carries a Chain Context and a dependency diagram marking the current PR); component-testing `/Users/jorgesanchez/dev/dforce-catalog/.claude/skills/component-testing/SKILL.md` (every `*.test.tsx`). Registry: `.atl/skill-registry.md`.

Budget rule: additions + deletions, tests and e2e INCLUDED, <= 400 per PR. A unit forecast over 400 at apply time splits at the fallback named in it; overrun never ships as a bigger PR.

Spec overrides design where they differ. Known differences:
- (a) The design has no SQL for "Esta semana"; the spec requires a count query independent of the visible range. Added as `agendaWeekCounts` (WU3, with e2e). The design's pure `weekSummary` becomes `toWeekSummary(counts)`.
- (b) `items.test.ts` today asserts "description is not in the item"; the spec and design put `description` on the item (card hides it, detail shows it). That test flips in WU2.
- (c) Grids render slot controls only when an optional `onSlot` is passed (a server-safe prop contract); the shell passes it from WU16.
- (d) The static Spanish long-day text ("Martes 27 de octubre") is a pure helper in `dates.ts` (WU10); no `Intl` in any client file.
- (e) Proposal questions 1-4 are assumed at their stated defaults; a different owner answer reopens WU1 (no-show), WU11 (editable detail) or WU12 (search scope).

Intermediate states: the tracker is not releasable until WU19. WU6-WU8 add grid components that are mounted in WU8, so their browser check is N/A until then. Between WU8 and WU10 a booked day card has no Reprogramar / No se presentó (the Detail lands in WU10); acceptable only inside the tracker.

### Suggested Work Units

| Unit | Goal | Branch (base) | Est. | Focused test command | Runtime harness | Rollback boundary |
|------|------|---------------|------|----------------------|-----------------|-------------------|
| 1 | Range query: vehicle make/model/year, categoria, description, technicians, no-show rows | `feat/agenda-redesign-wu1-range-read` (tracker) | 280 | `npx vitest run src/modules/agenda/queries.test.ts` | `npm run test:e2e -- src/e2e/agenda-queries.e2e.test.ts` | revert (read-side columns; old views ignore them) |
| 2 | Item fields, initials, no-show status text | `feat/agenda-redesign-wu2-item-fields` (wu1) | 210 | `npx vitest run src/modules/agenda/items.test.ts` | N/A: pure mapping | revert (additive fields) |
| 3 | Busy days, next appointment, week counts | `feat/agenda-redesign-wu3-side-reads` (wu2) | 240 | `npx vitest run src/modules/agenda/queries.test.ts` | `agenda-queries.e2e` (3 new SQL) | revert (new exports, unused) |
| 4 | In-workshop query: since-time, technicians, hold-since | `feat/agenda-redesign-wu4-workshop-read` (wu3) | 280 | `npx vitest run src/modules/agenda/items.test.ts src/modules/agenda/queries.test.ts` | `agenda-combined.e2e` | revert |
| 5 | `grid.ts`, `layoutDay`, colour hooks | `feat/agenda-redesign-wu5-grid-core` (wu4) | 295 | `npx vitest run src/modules/agenda/grid.test.ts src/modules/agenda/items.test.ts` | N/A: pure + CSS source test | revert (unused) |
| 6 | `AgendaCard`, `DayGrid` | `feat/agenda-redesign-wu6-card-day-grid` (wu5) | 330 | `npx vitest run src/modules/agenda/AgendaCard.test.tsx src/modules/agenda/DayGrid.test.tsx` | not mounted until WU8 | revert (new files) |
| 7 | `WeekGrid`, `ui/popover.tsx` | `feat/agenda-redesign-wu7-week-grid-popover` (wu6) | 320 | `npx vitest run src/modules/agenda/WeekGrid.test.tsx src/components/ui/popover.test.tsx` | not mounted until WU8 | revert (new files) |
| 8 | `AgendaShell` (selection) + page swap; Combined uses `DayGrid` | `feat/agenda-redesign-wu8-shell-wire` (wu7) | 260 | `npx vitest run src/modules/agenda "src/app/(app)/agenda"` | browser (first mounted UI) | revert (page returns to the old views) |
| 9 | Retire `DayView`, `WeekView` (deletions only) | `feat/agenda-redesign-wu9-retire-day-week` (wu8) | 195 | `npx vitest run src/modules/agenda` | N/A: dead-code removal | revert |
| 10 | `AgendaDetail` popover / sheet, actions | `feat/agenda-redesign-wu10-detail` (wu9) | 310 | `npx vitest run src/modules/agenda/AgendaDetail.test.tsx` | browser | revert (shell stops opening it) |
| 11 | Detail edits: type chips, assign technician | `feat/agenda-redesign-wu11-detail-edits` (wu10) | 245 | `npx vitest run src/modules/agenda/AgendaDetail.test.tsx` | `src/e2e/agenda-detail.e2e.test.ts` | revert (chips go read-only) |
| 12 | Search, tabs Todas/Agendadas, header layout | `feat/agenda-redesign-wu12-search-tabs` (wu11) | 390 | `npx vitest run src/modules/agenda/items.test.ts src/modules/agenda/AgendaTabs.test.tsx src/modules/agenda/AgendaHeader.test.tsx` | browser | revert |
| 13 | Vencidas tab; delete `VencidasPanel`, `ItemActions` | `feat/agenda-redesign-wu13-vencidas-tab` (wu12) | 355 | `npx vitest run src/modules/agenda "src/app/(app)/agenda"` | `agenda-combined.e2e` (Vencidas rows) + browser | revert |
| 14 | Side column container, "Filtros", type filter, "Esta semana" | `feat/agenda-redesign-wu14-sidebar-filter` (wu13) | 380 | `npx vitest run src/modules/agenda/AgendaSidebar.test.tsx src/modules/agenda/items.test.ts` | browser | revert |
| 15 | Mini calendar, "Próxima cita" | `feat/agenda-redesign-wu15-sidebar-calendar` (wu14) | 305 | `npx vitest run src/modules/agenda/MiniCalendar.test.tsx src/modules/agenda/NextCard.test.tsx` | browser | revert |
| 16 | Nueva cita: shell-owned dialog, slot prefill, vehicle, type | `feat/agenda-redesign-wu16-nueva-cita` (wu15) | 360 | `npx vitest run src/modules/agenda/AgendaBookingForm.test.tsx` | `agenda-booking.e2e` + browser | revert |
| 17 | Month view on cards; delete `AgendaChip` | `feat/agenda-redesign-wu17-month` (wu16) | 370 | `npx vitest run src/modules/agenda/MonthView.test.tsx` | browser | revert |
| 18 | Combined view: workshop cards | `feat/agenda-redesign-wu18-combined` (wu17) | 300 | `npx vitest run src/modules/agenda/CombinedView.test.tsx` | browser | revert |
| 19 | Phone: day strip, floating button, search control | `feat/agenda-redesign-wu19-phone` (wu18) | 250 | `npx vitest run src/modules/agenda/DayStrip.test.tsx src/modules/agenda/AgendaShell.test.tsx` | browser at 390 | revert |
| 20 | Owner sign-off, tracker merge, verify, archive | `feat/agenda-redesign-wu20-signoff` (wu19) | <60 | N/A | all mockup frames at the LAN IP | docs only |

### Closing blocks (the last task of every unit names which it runs)

- **C (every unit)**: C1 `npm test`, `npx tsc --noEmit`, `npm run lint` (0 errors, **13** warnings), plus `npm run test:e2e -- <file>` when the unit has e2e. C2 `gga config`, then `GGA_TIMEOUT=900 PR_BASE_BRANCH=<previous branch> gga run --pr-mode --diff-only` (tracker for WU1). C3 push, PR to the previous branch with Chain Context and the diagram, then state branch / pushed / merged.
- **B (every unit that mounts UI)**: at `http://192.168.0.7:3000` (never localhost, never 127.0.0.1): desktop, tablet 768 and 1024, phone 390, light and dark. Console clean after a FULL load and after a client navigation (no hydration mismatch, no RSC serialization error). Measure 44x44 on each new touch control. `textContent` lies after a client navigation: read the DOM. Post the result table in the PR.

Subagent prompts must carry: mutation-verify every fix (revert it, the NAMED test goes red); no unchecked claim in a type or comment; fixture shapes match the wire (`new Response(JSON.stringify(body), {status})`, `count` is a string over raw SQL); a green suite proves zero real-SQL coverage, so every new `WHERE`/`EXISTS`/aggregate has an e2e row; files are disjoint between parallel agents.

## WU1: range query (branch `feat/agenda-redesign-wu1-range-read`) [~280]

- [x] 1.1 RED e2e `src/e2e/agenda-queries.e2e.test.ts`: one row carries make, model, year, plate, `categoria`, description and both technician names; no vehicle/type/technician -> nulls and `[]`; three technicians -> same row count and `count()` totals as none; a deactivated technician is excluded. (Vehicle, type, description and technicians come back; Order without vehicle...; Technicians do not multiply rows)
- [x] 1.2 RED same file: `booked -> cancelled` after `appointment_at` returned with `noShow`; cancelled before it, `open -> cancelled` and cancelled-with-no-history all absent; the 8-status test now expects 7 rows. (Cancelled after the appointment time is a no-show; Cancelled from another status stays hidden; Status visibility)
- [x] 1.3 RED `queries.test.ts` (DB-free): source text contains the `EXISTS` on `orden_estado_historial`, `from_status = 'booked'`, `changed_at >` and no `AT TIME ZONE`; `AgendaRow` exposes `vehicleMake`, `vehicleModel`, `vehicleYear`, `categoria`, `description`, `noShow`, `technicians`.
- [x] 1.4 GREEN `src/modules/agenda/queries.ts`: extend `COLUMNS`/`AgendaRow`; second batched `inArray(ordenTecnico.ordenId, ids)` join `tecnico` (active only) grouped in TS (copy `board/queries.ts:47-59`); `agendaRange` WHERE becomes `status <> 'cancelled' OR EXISTS(...)`; `noShow` derived in TS as `status === "cancelled"` (the WHERE admits a cancelled row only as a no-show); `agendaOverdue` reuses the columns.
- [x] 1.5 Update the `AgendaRow` builder (in `items.test.ts`; `items.fixture.ts` holds items) rows to the new `AgendaRow` shape so tsc passes (no mapping change yet).
- [x] 1.6 Mutation-verify: drop the `changed_at >` comparison -> "Cancelled before the appointment is hidden" red; drop `from_status = 'booked'` -> "Cancelled from another status stays hidden" red; replace the batch with a join -> "Technicians do not multiply rows" red; include deactivated -> its test red.
- [ ] 1.7 Close: C (+ e2e file above).

## WU2: item fields (branch `feat/agenda-redesign-wu2-item-fields`) [~210]

- [x] 2.1 RED `items.test.ts`: `toAgendaItem` returns plain data (no `Date`/function): `minuteOfDay`, `vehicleLabel` ("AC 5521 · Toyota Corolla" / "Sin vehículo"), `vehicleDetail` (+ year), `categoria`, `categoriaLabel` (`CATEGORIA_LABEL`, "Sin categoría"), `description`, `technicians[{id,nombre,initials}]` (initials "Julio Rangel" -> "JR", "Marta" -> "M"), `noShow`; `noShow` => `statusLabel` "No se presentó" and `muted`; description present on the item (flips the old "not in the item" test). (Technician initials; Card fields; Status is text as well as colour)
- [x] 2.2 GREEN `items.ts`, `items.fixture.ts` (builder gains the new fields; every existing test file compiles).
- [x] 2.3 Mutation-verify: initials from the first word only -> "Technician initials" red; drop `noShow` -> "No se presentó" text test red; `Date` left in the item -> the serializability test red.
- [ ] 2.4 Close: C.

## WU3: side reads (branch `feat/agenda-redesign-wu3-side-reads`) [~240]

- [x] 3.1 RED e2e `src/e2e/agenda-queries.e2e.test.ts` (DB session and server zone UTC): `agendaBusyDays(scope, month)` returns exactly the two days with appointments, a 23:30-Panama row belongs to D (not D+1), a cancelled-before-time order's day is absent; `agendaNext(scope, now)` skips a past booked and a future `open`, picks the earliest future booked beyond the visible range, returns null when none; `agendaWeekCounts(scope, week)` returns Agendadas 5 / Vencidas 2 / Recibidas 3 / No se presentó 1 for the seeded week, independent of the range. (Busy days are real; Próxima cita beyond the visible range / ignores non-booked and past; Week summary counts)
- [x] 3.2 RED `queries.test.ts`: exports exist, scope REQUIRED (tsc), bound Panama instants only, `count()` not raw.
- [x] 3.3 GREEN `queries.ts`: `agendaBusyDays` (select `appointment_at` of the bound Panama month range, no `AT TIME ZONE`; derive and dedupe day keys in TS with `panamaDay`), `agendaNext`, `agendaWeekCounts` (one grouped query, drizzle `count()`).
- [x] 3.4 RED/GREEN `items.ts` + `items.test.ts`: `nextLabel(appointmentAt, now)` -> "en 20 min" (<60), "en 1 h 20 min" (<24 h), `DD/MM/YYYY` later; `toWeekSummary(counts)`.
- [x] 3.5 Mutation-verify: use the UTC day for busy days -> "Busy days are real" red; remove `status = 'booked'` from next -> "ignores non-booked" red; count by visible range -> "Week summary counts" red.
- [ ] 3.6 Close: C (+ e2e).

## WU4: in-workshop read (branch `feat/agenda-redesign-wu4-workshop-read`) [~280]

- [x] 4.1 RED e2e `src/e2e/agenda-combined.e2e.test.ts`: since-time comes from the latest status-change history row (created 5 days ago, `in_progress` 3 h ago -> 3 h), falling back to `created_at`; `on_hold` carries its hold-since from the `-> on_hold` row; technicians and make/model/`categoria` present; the set is still exactly the five statuses; board bodies still carry no sentinel customer. (Time in status uses the history row; In-workshop set; Board payload still carries no customer data)
- [x] 4.2 RED `items.test.ts`: `toWorkshopItem` adds `dot` category, `vehicleLabel`, technician initials ("MP JR" / "Sin técnico"), `sinceLabel` via a private `durationText` (not `formatAge`, whose "1 d" the spec rejects) ("35 min", "2 h 40 min", "1 día", "2 días"), hold reason + "hace 2 días" only while `on_hold`. (Time in status; Hold reason shown only while on hold)
- [x] 4.3 GREEN `queries.ts` (`agendaInWorkshop`: latest-history batch, technician batch, new columns), `items.ts`, `items.test.ts`; `CombinedView.tsx` only adapts to the new type (no redesign).
- [x] 4.4 Mutation-verify: take the OLDEST history row -> "uses the history row" red; show hold reason for `in_progress` -> its test red.
- [ ] 4.5 Close: C (+ e2e).

## WU5: grid core (branch `feat/agenda-redesign-wu5-grid-core`) [~295]

- [x] 5.1 RED `grid.test.ts`: `hourWindow` = [8,18] default; items at 07:15 and 18:45 -> [7,20]; `top()` of 14:30 is half a row below 14:00 (`ROW=104`); the now-line is visible only when today is shown and inside the window (10:40 yes, 19:30 no). (Grid hours; Outside the window; Now-line only on today / outside the grid)
- [x] 5.2 RED `items.test.ts`: `layoutDay`: 11:00, 11:00 and 11:30 -> three equal lanes; stable (time, id) order; non-overlapping items share one lane. (Overlap shares the width; Overlap is deterministic)
- [x] 5.3 RED `agenda-colour.test.ts` (source text of `globals.css`): `.agenda-ev`, `.agenda-ev-strip`, `.agenda-dot` with the six `[data-categoria=...]` hues (262/205/35/350/152/240) and a `.dark .agenda-ev` variant.
- [x] 5.4 GREEN `grid.ts`, `layoutDay` in `items.ts`, `globals.css` `@layer components` (formula from mockup lines 47-56).
- [x] 5.5 Mutation-verify: window clamp to 8-18 only -> "Outside the window" red; off-by-one in `top` -> "Grid hours" red; id-only sort -> "Overlap is deterministic" red.
- [ ] 5.6 Close: C (no browser: nothing mounted).

## WU6: card and day grid (branch `feat/agenda-redesign-wu6-card-day-grid`) [~330]

- [x] 6.1 RED `AgendaCard.test.tsx` (component-testing skill): the strip reads "11:00 · REVISADO"; name; "AC 5521 · Toyota Corolla"; "JR"; NO status label for a plain booked card; NO phone, NO description; "Sin categoría" / "Sin vehículo" / "Sin técnico" when null; status text for Recibida, Completada, Vencida, No se presentó (struck-through name); a `<button>` with `data-categoria`, `aria-pressed` when selected, `min-h-11`; five typed cards carry five distinct hooks. (Card fields; No vehicle, no type...; Colour follows the type; Status is text as well as colour)
- [x] 6.2 RED `DayGrid.test.tsx`: hour rows 08:00-17:00 with labels; a 14:30 block offset; three 09:00 cards all present; "Sin citas para este día" on an empty day; the now-line labelled `HH:mm` only on today; with `onSlot` each free hour is a focusable button named with day and hour, without it none render. (Empty day; Empty slot is a labelled control)
- [x] 6.3 GREEN `AgendaCard.tsx`, `DayGrid.tsx` (plain components, no `"use client"`, no server imports, `HH:mm` digits only).
- [x] 6.4 Mutation-verify: render the description -> "Card fields" red; remove `data-categoria` -> "Colour follows the type" red; drop the guard on the now-line -> "Now-line" red.
- [ ] 6.5 Close: C. Browser: N/A until WU8 (unmounted).

## WU7: week grid and popover (branch `feat/agenda-redesign-wu7-week-grid-popover`) [~320]

- [x] 7.1 RED `WeekGrid.test.tsx`: seven Monday-first columns with weekday, day number and per-day count; today's header carries "Hoy"; Saturday and Sunday carry the weekend mark; exactly one now-line, in today's column; none for a week without today; an overlapping run shows its first card at full width (no lanes in the week) plus a 44px "+N más" link (N = hidden cards) to `/agenda?view=day&date=<day>`; each free hour a labelled button when `onSlot` is given. (Today and weekends are marked; Now-line only on today; Empty slot is a labelled control)
- [x] 7.2 RED `components/ui/popover.test.tsx`: controlled `open`; non-modal; `Positioner anchor` is the given element; closes on Escape and outside press; renders no portal while closed.
- [x] 7.3 GREEN `WeekGrid.tsx`, `src/components/ui/popover.tsx` (Base UI wrapper).
- [x] 7.4 Mutation-verify: render the now-line in every column -> "Now-line only on today" red; mark only Sunday -> "Today and weekends are marked" red; open the popover while `open=false` -> its test red.
- [ ] 7.5 Close: C. Browser: N/A until WU8.

## WU8: shell wire (branch `feat/agenda-redesign-wu8-shell-wire`) [~260]

- [x] 8.1 RED `AgendaShell.test.tsx`: renders `DayGrid` for day, `WeekGrid` for week, the legacy `MonthView` for month; activating a card marks it `aria-pressed`; props are plain (no function or `Date`) so the page output serializes.
- [x] 8.2 RED `page.test.tsx`: day/week/combined render through the shell; queries still called with `orderScope(user)`; `now` captured once and passed through; Técnico still denied.
- [x] 8.3 GREEN `AgendaShell.tsx` (`"use client"`, selection state only), `page.tsx` swap, `CombinedView.tsx` uses `DayGrid`.
- [x] 8.4 Mutation-verify: pass a function prop from the page -> the serializability test red; remove `can()` -> "Técnico is denied" red.
- [ ] 8.5 Close: C + B. This is the RSC-boundary check: open week and combined with real data (the Pagination trap: one row hides it; seed enough).

## WU9: retire the old day/week views (branch `feat/agenda-redesign-wu9-retire-day-week`) [~195, deletions only]

- [x] 9.1 Confirm by `rg` that nothing imports `DayView` or `WeekView`; delete `DayView.tsx`, `DayView.test.tsx`, `WeekView.tsx`, `WeekView.test.tsx`; move any still-meaningful assertion into the new tests first (RED if absent).
- [x] 9.2 Close: C. Browser: smoke load of day and week (no console error).

## WU10: detail (branches `feat/agenda-redesign-wu10-detail` = Detail component + card anchors, and `feat/agenda-redesign-wu10b-detail-mount` = shell mount; split at ~470 lines) [~310 forecast]

- [x] 10.1 RED `dates.test.ts`: `formatLongDay("2026-10-27")` = "Martes 27 de octubre" from static tables (no `Intl`); the agenda-safety test still passes.
- [x] 10.2 RED `AgendaDetail.test.tsx`: booked, not Vencida -> "Cita agendada", name, "Martes 27 de octubre", "11:00", "AC 5521 · Toyota Corolla 2019", `tel:` link, description ("Sin descripción" when empty), five chips with "REVISADO" marked, "Julio Rangel", "Abrir orden" (button and pencil with that accessible name), "Reprogramar", no "No se presentó"; Vencida -> both actions; `open` -> only "Abrir orden", read-only chips; no-show -> only "Abrir orden"; Escape / outside press / close control (44x44) close it and the card loses `aria-pressed`. (Detail content; Vencida Detail offers both actions; Muted Detail is read-only; Close affordances; Reprogramar lives in the Detail only)
- [x] 10.3 RED `AgendaShell.test.tsx`: `matchMedia("(min-width: 768px)")` read inside the click handler picks popover vs `Sheet side="bottom"` with `showCloseButton={false}` and our own "Cerrar"; Reprogramar and No se presentó open the existing dialogs.
- [x] 10.4 GREEN `AgendaDetail.tsx`, `dates.ts` (`formatLongDay`), shell wiring; dialogs `ReprogramDialog`/`NoShowConfirm` reused unchanged beyond the new item shape.
- [x] 10.5 Mutation-verify: offer No se presentó when not Vencida -> "Detail content" red; make chips editable for `open` -> "Muted Detail is read-only" red; use `typeof document` -> safety test red.
- [x] 10.6 Close: C + B. The popover anchors and flips at the right edge; the sheet is reachable at 390 and does not widen the page; a Monday week card's Detail is not clipped at 1024; confirm the portrait-tablet (768) popover on the device (design open question).

## WU11: detail edits (branch `feat/agenda-redesign-wu11-detail-edits`) [~245]

- [x] 11.1 RED e2e `src/e2e/agenda-detail.e2e.test.ts`: PATCH `{categoria:"reparacion", expectedStatus:"booked"}` persists; the same PATCH on an order received elsewhere -> 409 `stale_status`, `categoria` unchanged. (Edit the type persists; Stale type edit)
- [x] 11.2 RED `AgendaDetail.test.tsx`: chip click sends exactly `{categoria, expectedStatus:"booked"}` and toasts "Categoría actualizada" ABOVE `router.refresh()`, both below the try/catch (a throwing refresh must not retract the toast); 409 shows the message inline, no toast; control disabled in flight; "+ Asignar técnico" absent without `service-orders.assign`; picker lists the roster minus the item's technicians; POST `assignments` with `tecnicoId`, toast "Técnico asignado", `order_closed` 409 inline.
- [x] 11.3 GREEN `AgendaDetail.tsx` (`patchOrder`, `AssignTecnicoControl`), `page.tsx` (`listTecnicos()` only when `can(user,"service-orders.assign")`, roster as plain props).
- [x] 11.4 Mutation-verify: toast below `router.refresh()` -> the call-order test red; drop `expectedStatus` -> payload test red; always render assign -> "Assign control follows the permission" red.
- [x] 11.5 Close: C + B (toast, 44x44 chips).

## WU12: search, tabs, header (branch `feat/agenda-redesign-wu12-search-tabs`) [~390; fallback: header layout moves to WU13]

- [x] 12.1 RED `items.test.ts`: `matchesSearch` ignores case, accents (NFD) and plate spaces/hyphens ("ab1234" -> "AB 1234", "sofia" -> "Sofía Herrera"); empty matches all; `filterItems("agendadas")` keeps only booked, non-Vencida; "todas" keeps every card incl. no-show. (Search by plate / by customer; Agendadas excludes Vencida and muted; Todas shows every card)
- [x] 12.2 RED `AgendaTabs.test.tsx`: three tabs with badges, Agendadas badge counts the cards left visible, Vencidas badge shows the true N; client state, no navigation; pills >= 44px. (Tabs on every view; Tab survives a filter)
- [x] 12.3 RED `AgendaHeader.test.tsx` and shell test: placeholder "Buscar placa o cliente…"; nothing matches -> "Sin resultados"; a match outside the loaded range shows nothing and sends no request; search text survives a tab switch; the combined "En el taller ahora" list is unaffected.
- [x] 12.4 GREEN `items.ts`, `AgendaTabs.tsx`, `AgendaShell.tsx` state + search field. The `AgendaHeader.tsx` mockup layout (and the search placed in it) moved to WU13 per the fallback: the header is a server component and the search state lives in the shell.
- [x] 12.5 Mutation-verify: skip NFD -> "by customer ignoring accents" red; count the unfiltered cards in the badge -> its test red; filter the workshop list -> "Shop list is unaffected" red.
- [x] 12.6 Close: C + B.

## WU13: Vencidas tab (branch `feat/agenda-redesign-wu13-vencidas-tab`) [~355]

- [x] 13.1 RED shell/tab test: the Vencidas tab lists every Vencida row oldest first, each with `DD/MM/YYYY HH:mm` digits ("12/09/2026 09:30") and the card fields, opening the Detail; badge = `total` (not `rows.length`); N = 0 -> "Sin citas vencidas"; truncation notice at 500; a marked no-show leaves the list and the badge drops by one. (Vencidas list row; Empty state; Count is the true count; Cancelled no-show leaves the tab)
- [x] 13.2 RED e2e `agenda-combined.e2e.test.ts`: 40-day-old booked appears with the week view of today; 3 Vencida (one in range) -> badge 3; 501 -> 500 rows + notice + badge 501; cancelled via No se presentó leaves the tab and shows in the grid as a no-show. (Old overdue appointment never disappears; Vencidas list is capped; Cancelled no-show leaves the tab)
- [x] 13.3 GREEN shell tab body, `page.tsx` (drop panel and the `actions` function prop), DELETE `VencidasPanel.tsx`, `VencidasPanel.test.tsx`; `page.test.tsx` updated. `ItemActions.tsx` and its test are KEPT: `AgendaDetail` still renders it (only its VencidasPanel case was removed). Also done here: the `AgendaHeader` mockup layout deferred from WU12.
- [x] 13.4 Mutation-verify: badge from `rows.length` -> "Count is the true count" red; sort newest first -> its order test red; drop the cap notice -> the notice test red.
- [x] 13.5 Close: C (+ e2e) + B.

## WU14: side column, type filter, week summary (branch `feat/agenda-redesign-wu14-sidebar-filter`) [~380; fallback: "Esta semana" moves to WU15]

- [x] 14.1 RED `items.test.ts`: `typeCounts` (4 revisado, 2 reparacion, 2 sin tipo -> 4/2/2, others 0) is independent of search and checkboxes; `filterItems` honours the unchecked set.
- [x] 14.2 RED `AgendaSidebar.test.tsx`: order mini calendar slot, "Próxima cita" slot, "Categoría", "Esta semana"; six checkboxes with dot and count, all checked, unchecking hides the cards, counts unchanged, "Todos" re-checks all six; summary shows Agendadas / Recibidas / Vencidas / No se presentó from `toWeekSummary`; below `xl` (1280) hidden behind a "Filtros" button (`min-h-11 min-w-11`). (Type counts; Unchecking hides a type; Todos resets; Column collapses behind Filtros)
- [x] 14.3 GREEN `AgendaSidebar.tsx`, shell filter state, `page.tsx` (`agendaWeekCounts`).
- [x] 14.4 Mutation-verify: counts from the filtered list -> "Type counts" red; "Todos" leaves one unchecked -> "Todos resets" red.
- [x] 14.5 Close: C + B (the "Filtros" button at 768).

## WU15: mini calendar and Próxima cita (branch `feat/agenda-redesign-wu15-sidebar-calendar`) [~305]

- [x] 15.1 RED `MiniCalendar.test.tsx`: Monday-first grid; dots only on the two busy days, with the text "con citas"; cells are links `/agenda?view=week&date=2026-10-xx`; "next month" targets `date=2026-11-01`; the selected week (Mon 26 - Sun 1) highlighted; today marked. (Mini calendar busy dots / navigation)
- [x] 15.2 RED `NextCard.test.tsx`: "Próxima cita · en 20 min" with "11:00", customer, vehicle, description, "Abrir orden" and a `tel:` button (both 44x44); "Sin citas próximas"; `rg` finds no `setInterval`/`setTimeout` in the agenda files. (Próxima cita text / empty / is static)
- [x] 15.3 GREEN `MiniCalendar.tsx`, `NextCard.tsx`, `page.tsx` (`agendaBusyDays`, `agendaNext` into the `Promise.all`).
- [x] 15.4 Mutation-verify: dot on every day -> "busy dots" red; a timer in the card -> the static test red.
- [x] 15.5 Close: C + B (dots after a month navigation).

## WU16: Nueva cita (branch `feat/agenda-redesign-wu16-nueva-cita`) [~360]

- [ ] 16.1 RED e2e `agenda-booking.e2e.test.ts`: POST with `vehiculoId` + `categoria` persists a `booked` order with both; a `vehiculoId` of another customer is refused with a Spanish message and nothing inserted. (Persists vehicle and type; Server rejection)
- [ ] 16.2 RED `AgendaBookingForm.test.tsx` (non-Panama `TZ`): body without optionals has no `vehiculoId`/`categoria`/`tecnicoIds`; with them it carries both; vehicles fetched from `GET /api/customers/[id]/vehicles` after selection, listed as `plate · make model`, cleared on customer change, no-vehicles note, a fetch FAILURE is not "no vehicles"; chips clearable; slot prefill (day + `:00` hour); header default = selected `date`, time empty; required fields rejected client-side; toast "Cita agendada" above `router.refresh()`; server rejection inline; submit disabled in flight.
- [ ] 16.3 RED grid tests: `onSlot(day, time)` fires from `DayGrid` and `WeekGrid` slot buttons.
- [ ] 16.4 GREEN `AgendaBookingForm.tsx` (controlled, `initialDay`, `initialTime`, vehicle, type), shell-owned `Dialog` with `openBooking(day, time?)`, header button wiring, grids receive `onSlot`.
- [ ] 16.5 Mutation-verify: send `tecnicoIds` -> "Request body" red; build the instant with `new Date().toISOString()` -> red under the non-Panama `TZ`; keep the vehicle on customer change -> "Vehicle choices follow the customer" red; treat a failed fetch as empty -> its test red.
- [ ] 16.6 Close: C (+ e2e) + B: book from the header and from an empty slot; the new card appears without reload; works over plain HTTP from a second machine, no `crypto.randomUUID`.

## WU17: month (branch `feat/agenda-redesign-wu17-month`) [~370]

- [ ] 17.1 RED `MonthView.test.tsx`: five appointments -> 3 cards + "+2 más" linking `/agenda?view=day&date=<day>`; exactly 3 -> no control; 4 -> "+1 más"; cards are buttons opening the Detail with a status glyph and accessible "Vencida"; outside-month days dimmed but carrying cards; today marked; phone width -> day number link plus "2 citas" only, no cards, no "+N más"; the cell "+" opens booking prefilled with that day; cells and controls `min-h-11 min-w-11`. (Month cell cap; Phone month cell; Month card carries status text; Month cell prefill)
- [ ] 17.2 GREEN `MonthView.tsx`, shell passes `onSelect` / `onSlot`; DELETE `AgendaChip.tsx`, `AgendaChip.test.tsx`; drop `DayBooking` from `AgendaBookingForm.tsx` if unused.
- [ ] 17.3 Mutation-verify: `slice(0,4)` -> "Month cell cap" red; `>= 3` -> "Exactly three" red; render cards on the phone -> its test red.
- [ ] 17.4 Close: C + B (768 portrait month is mockup frame 3).

## WU18: combined (branch `feat/agenda-redesign-wu18-combined`) [~300]

- [ ] 18.1 RED `CombinedView.test.tsx`: grid and "En el taller ahora" with a count badge; each card shows the dot, plate + make model or "Sin vehículo", name, status label, since-time, technician initials or "Sin técnico", the hold reason + "hace 2 días" only while `on_hold`, links to `/service-orders/<id>`, no phone; `lg:grid-cols-2` side by side, grid first when stacked. (Technicians on the card; Side by side and stacked)
- [ ] 18.2 GREEN `CombinedView.tsx` on the WU4 workshop items and shell props.
- [ ] 18.3 Mutation-verify: show the phone -> its test red; reason for `in_progress` -> "Hold reason" red.
- [ ] 18.4 Close: C + B (mockup frame 2 at 1024; stacked at 390).

## WU19: phone (branch `feat/agenda-redesign-wu19-phone`) [~250]

- [ ] 19.1 RED `DayStrip.test.tsx`: seven Mon-Sun links rewriting `date`, dots on Tuesday and Thursday, today marked, selected highlighted, each 44x44; the hour grid shows the selected day only; the strip scrolls inside itself.
- [ ] 19.2 RED `AgendaShell.test.tsx`: phone FAB "Nueva cita" (>= 44px) opens booking with the selected day and empty time; the search control reaches the search field; the side column and mini calendar are hidden on a phone.
- [ ] 19.3 GREEN `DayStrip.tsx`, shell phone chrome and class gates.
- [ ] 19.4 Mutation-verify: drop the dots -> "Phone day strip" red; FAB prefilled with a time -> "Header and floating button defaults" red.
- [ ] 19.5 Close: C + B (390 is mockup frame 4: day, and the sheet).

## WU20: sign-off, verify, archive (branch `feat/agenda-redesign-wu20-signoff`)

- [ ] 20.1 Seed realistic data on the dev DB (several days, a month cell with more than 3, every status, a no-show, a Vencida, a no-vehicle booking, 3 technicians on one order); owner walks EVERY mockup frame at the LAN IP, light and dark: 1 desktop week with detail, 2 combined 1024, 3 month 768, 4 phone day and sheet, 5 Nueva cita, the legend. Record per frame pass/fail in the PR.
- [ ] 20.2 Second-machine pass at the LAN IP (carry-over from the previous agenda). Defects found are fix commits on the owning WU branch, test first.
- [ ] 20.3 Mark tracker ready, merge the chain in order, then the tracker to `main` (state branch / pushed / merged). Run `/sdd-verify`, then `/sdd-archive`: remove the "Vencidas Panel" requirement from the main spec, keep MODIFIED headings byte-identical to the main spec (a rename makes a mechanical apply duplicate), `rg` for stale panel wording.

## Follow-ups (out of scope, from the proposal)

- Duration and capacity (cards stay fixed at 1 h; overlap warnings).
- Drag-to-reschedule.
- Polling or auto-refresh (the Próxima cita text and the now-line freeze at render).
- Technician assignment at booking (assign stays in the Detail).
- Server-side search (search and filter cover the loaded range only).
- The collapsed-rail shell change.
- Extract the vehicle-fetch hook shared with `ServiceOrderForm.tsx:187-211` (copied here on purpose).
- The `PATCH categoria` route cannot unset a type (`isServiceCategory` rejects null).
- The 500-row truncation notice still needs a browser look with 500+ rows.
- Clearing the 13 existing lint warnings.
- The side-read e2e tests assert exact results across the whole database and rely on owning their months (2032-01, 2032-03, 2031-12; `agendaNext` after 2032-05 is null): scope them per test or move the dates if another e2e file seeds those months.
