# Verification Report: agenda-redesign

**Verdict: PASS WITH WARNINGS** (0 CRITICAL, 5 WARNING, 3 SUGGESTION)
Change: `agenda-redesign` | Mode: openspec | Strict TDD: active | Verified on `main` @ fce2d9f (agenda tracker #283 and kanban tracker #305 merged), 2026-10-28.
Owner sign-off: the owner approved merging on 2026-10-28 (stated by the orchestrator; no per-frame record exists in the artifacts, see W3).

## Runtime evidence (all run in this session)

| Command | Exit | Result |
|---|---|---|
| `npm test` | 0 | 282 files, 4357 tests passed |
| `npx tsc --noEmit` | 0 | clean |
| `npm run lint` | 0 | 0 errors, 13 warnings (matches the standing count) |
| `DATABASE_URL=.../dforce_e2e npm run test:e2e` on a freshly recreated `dforce_e2e` | 0 | 34 files, 397 tests passed; no sign of interference (no other connection to `dforce_e2e` before the run) |

Not run: any browser check. Every `[browser]` scenario (9) is NOT verified by me.

## Completeness

Tasks: 88 `[x]`, 11 `[ ]`. Unchecked: 1.7, 2.4, 3.6, 4.5, 5.6, 6.5, 7.5, 8.5 (WU1-WU8 closing blocks) and 20.1-20.3. Chain evidence: PRs #284-#304 (WU1-WU19, plus `wu10b-detail-mount` #294 and `wu11b-assign` #296) are all merged into the tracker, which merged as #283. Spec: 13 active requirements (9 modified, 4 added) + 1 removed; 121 scenarios.

## Spec compliance (requirement level; every [unit]/[e2e] scenario has a named test in the green suite)

| Requirement | Code evidence | Test evidence | Result |
|---|---|---|---|
| Agenda Access | `src/app/(app)/agenda/page.tsx:15` `can(user,"agenda.manage")`; `policy.ts:42`; `route-guards.test.ts:134` | policy.test.ts:128, nav-items.test.ts:89, page.test.tsx:127, layout.test.tsx:80; no route file added by the change (`git diff f05b38b^1 f05b38b -- src/app/api` empty) | COMPLIANT. "No new route" has no dedicated test (S1) |
| Range Query / Panama midnights | `queries.ts:89-99` (bound instants, `cap+1`, order, scope), `:58-64` no-show EXISTS, `:67-79` technician batch | agenda-queries.e2e.test.ts:94,108,123,135,171,184,198,254 | COMPLIANT |
| Which Orders Appear | `queries.ts:64` `SHOWN`; muted/no-show in items.ts + AgendaCard | e2e :123,198,219; AgendaCard/Detail unit tests | COMPLIANT |
| Chip Content | `AgendaCard.tsx`, `items.ts` (initials, labels), `globals.css` colour hooks | AgendaCard.test, agenda-colour.test, items.test, agenda-safety.test | COMPLIANT |
| Day/Week/Month Layout | `grid.ts:7` ROW=104, `hourWindow`, `nowLineTop`; `WeekGrid.tsx:43,93,104` (Hoy, "+N más", now-line); `MonthView.tsx:87`; `DayStrip.tsx` | grid/DayGrid/WeekGrid/MonthView/DayStrip tests | COMPLIANT in jsdom; 2 [browser] scenarios unverified (W3) |
| Combined View | `queries.ts:203-235` (`agendaInWorkshop`, history batch), `CombinedView.tsx:66` | agenda-combined.e2e :96,110,198,213,229,246; CombinedView.test | COMPLIANT; board still has no `cliente` (e2e :246) |
| Reprogramar | `ReprogramDialog.tsx`; route `src/app/api/service-orders/[id]/route.ts:64-66,151,159,190`; `service.ts:357,466` | agenda-actions.e2e :74,128,145; service.test.ts:411,430 | COMPLIANT |
| No se presentó | `NoShowConfirm.tsx`; `service.ts:357` | agenda-actions.e2e :88,100,116; service.test.ts:657-681 | COMPLIANT |
| Booking Dialog | `AgendaBookingForm.tsx`, `AgendaShell.tsx:63,142` | agenda-booking.e2e :67,86,96; AgendaBookingForm.test | COMPLIANT except presentation (W2) |
| Appointment Detail | `AgendaDetail.tsx:29,78,98`; assign via `AssignTecnicoControl.tsx:51` | AgendaDetail.test, agenda-detail.e2e :69,79 | COMPLIANT; popover-vs-sheet and clipping are [browser] (W3) |
| Agenda Tabs | `AgendaTabs.tsx`, `VencidasList.tsx:4,19,25`, `queries.ts:143-161` | agenda-combined.e2e :149,170,185; agenda-queries.e2e :291,306 | COMPLIANT |
| Search and Type Filter | `items.ts:183-205`, `AgendaSidebar.tsx` | items.test, AgendaSidebar.test, shell tests | COMPLIANT |
| Agenda Side Column | `AgendaSidebar.tsx:35-39` (`xl`), `MiniCalendar.tsx`, `NextCard.tsx`; `queries.ts:102,112,127` | agenda-queries.e2e :342,354,369; MiniCalendar/NextCard tests; agenda-safety.test.ts:38 (no timers) | COMPLIANT |
| REMOVED: Vencidas Panel | `VencidasPanel*` deleted (WU13) | page.test.tsx | COMPLIANT |

## Documented deviations (all recorded in apply-progress.md)

| Deviation | Where recorded | Status |
|---|---|---|
| "Categoría" vocabulary instead of mockup "Tipo de servicio" (heading, `CATEGORIA_LABEL`) | WU14, WU16, spec "Added terms" | OK, spec agrees |
| Week: one lane + "+N más" | WU8 correction; spec, tasks 7.1 and design amended | OK |
| Side column from `xl` (1280), "Filtros" below | WU15 correction 2; spec and task 14.2 amended | OK |
| WU10 split (`wu10`, `wu10b-detail-mount`) | tasks.md WU10 header | OK |
| WU11 split (`wu11b-assign`, PR #296) | WU11 section only names the seams as a possibility | Partial (W4) |
| "Revisado" -> "REVISADO" (app vocabulary) | WU2 | OK; spec text already reads REVISADO |

## Issues

### CRITICAL
None.

### WARNING
- **W1. Eight closing tasks stay unchecked** (1.7, 2.4, 3.6, 4.5, 5.6, 6.5, 7.5, 8.5). Each is a "Close: C (+B)" block (gates, GGA, push, PR). Gates are recorded green in apply-progress and all PRs merged, so this reads as bookkeeping never done by the orchestrator. Tick them or record "closed via merged PR #28x".
- **W2. Booking Dialog differs from the spec text and the spec was not amended.** Spec: "a popover (a full-screen card on a phone)". Code: a centred `Dialog` (`AgendaBookingForm.tsx:31-32`) with native `type="date"`/`type="time"` inputs (`:148,152`). Recorded as a deviation in apply-progress WU16 (design chose the Dialog) but spec.md still says popover. Amend the spec at archive, or the main spec will state something the code does not do.
- **W3. Nine [browser] scenarios and the 20.1/20.2 owner passes have no artifact record.** Verified by me: none (no browser run). Apply-progress shows LAN-IP checks happened for WU8, WU15 and WU19 corrections; the owner sign-off is the orchestrator's statement. Task 20.1 asked for a per-frame pass/fail table "in the PR"; it is not in the change folder. Affected: Tablet and phone layouts, Hit targets, Presentation by width, Not clipped in a week column, Booking success feedback, Works over plain HTTP, Side by side and stacked, Column collapses behind Filtros. All 44x44 checks in the unit suite are class pins only.
- **W4. WU11 was split (`wu11b-assign`, #296) but tasks.md and apply-progress do not say so.** The task list still shows WU11 as one unit and the WU11 entry (~483 lines, over budget) only lists seams.
- **W5. Known real-browser risk recorded and never closed**: a press inside the Reprogramar / No se presentó dialog may count as an outside press for the Detail popover, killing the dialog state (apply-progress WU10 "Not verified"). jsdom cannot show it. Confirm in a browser or note the owner pass covered it.

### SUGGESTION
- **S1.** "No new route" is covered by diff inspection only; no test asserts the route tree. Low value to add, but the scenario is tagged [unit].
- **S2.** The side-read e2e tests own fixed eras (2032-01, 2032-03, 2031-12) and assert DB-wide totals (tasks.md follow-up). Fragile if another e2e file seeds those months; it passed in the full 34-file run.
- **S3.** At archive: strip stale "Tipo de servicio"/"Tipo" wording from proposal.md, keep MODIFIED headings byte-identical to the main spec, remove the "Vencidas Panel" requirement (task 20.3). The mockup's progress bars/icons and styled date fields were dropped on purpose (cosmetic).

## Validator note
`gentle-ai sdd-verify-validate` does not exist in gentle-ai 3.7.0 (`unknown command`), so no pre-write validation ran. This report was written to the requested openspec path on the orchestrator's instruction; it carries no native settlement attestation.

## Final verdict: PASS WITH WARNINGS
Ready for `sdd-archive` after resolving W1-W4 as documentation edits; W3/W5 need the owner's confirmation, not code.
