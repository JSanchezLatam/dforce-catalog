# Verify Report: metrics-dashboard

Date: 2026-10-07. Branch: chore/archive-metrics-dashboard (main + metrics-dashboard merged). Mode: openspec (Engram unavailable).

## Verdict: PASS WITH WARNINGS (0 CRITICAL, 4 WARNING, 2 SUGGESTION)

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm test` | 202 files, 3123 tests passed, exit 0 |
| `npm run lint` | 0 errors, 13 warnings (matches the 0/13 baseline), exit 0 |
| `npm run test:e2e` on throwaway `dforce_e2e` (created fresh, dropped after) | 17 files, 206 passed, 0 skipped (clean DB) |

Tasks: WU1-WU4 all `[x]`. Open: 5.1 (this archive step) and 5.2 (follow-ups list, not code). Neither blocks.

## Spec scenarios -> covering test (all passed at runtime)

| Scenario | Covering test |
|---|---|
| Roles that may read | `policy.test.ts` metrics.read/metrics.self grant tables; `route-guards.test.ts` (`/metrics` -> metrics.read); `metrics/page.test.tsx` "gives %s the open backlog counters" (admin, jefe) + "refuses a técnico with the denial screen" |
| Both figures shown (3 closed, 270 min -> 4.5) | `TechnicianMonthTable.test.tsx` "has the three columns and shows closed orders and hours with one decimal"; `shape.test.ts` "converts 270 minutes to 4.5 hours" + "joins closed and hours per technician" |
| Cancelled order | `metrics.e2e.test.ts` "a cancelled order counts as received only, never closed" |
| Valid month | `metrics/page.test.tsx` "honours ?mes=2026-08 for the table and the select"; `months.test.ts` parseMes "accepts a key inside the 12-month list" |
| Invalid month | `metrics/page.test.tsx` "falls back to the current month for ?mes=%j" (garbage, 2019-01, array); `months.test.ts` parseMes it.each |
| Two technicians | `shape.test.ts` "credits every assignee of a shared order"; `metrics.e2e.test.ts` "two assignees on one order get 1 each while the order total is 1"; `TechnicianMonthTable.test.tsx` "says a shared order counts for every assignee" (note visible) |
| Month boundary | `metrics.e2e.test.ts` "the Panama boundary: 04:59Z on Mar 1 closes in February, 05:00Z closes in March" and "the same boundary buckets received"; `months.test.ts` currentMonthKey 04:59Z / 05:00Z |
| Six-month window | `months.test.ts` "builds 6 keys oldest first across a year boundary"; `metrics/page.test.tsx` "lists six months of received and closed orders, newest first, zero-filled" and "plots the six months oldest to newest..." |
| Zero month | `shape.test.ts` "zero-fills a month with no rows against the key list"; page test above |
| Backlog counts | `metrics.e2e.test.ts` "backlog counts open, in_progress and ready_for_review as integers, never done or cancelled"; `shape.test.ts` fillBacklog; `BacklogCounters.test.tsx`; `metrics/page.test.tsx` counters zero-filled |
| Own numbers only | `metrics.e2e.test.ts` "the tecnicoId filter returns only that technician's rows" and "the técnico's own page path..."; `mis-numeros/page.test.tsx` "resolves the roster id from the session user and queries with it" |
| Forged parameter | `mis-numeros/page.test.tsx` "ignores a forged tecnicoId / tecnico param and keeps the session's id" |
| Mis números denied to admin and jefe | `mis-numeros/page.test.tsx` "refuses %s with the denial screen and reads nothing" |
| Metrics page denied | `metrics/page.test.tsx` "refuses a técnico with the denial screen and reads nothing" |
| Técnico without roster row | `mis-numeros/page.test.tsx` "teaches an unlinked técnico what to do, with no error and no query"; `metrics.e2e.test.ts` "a login with no roster row resolves no technician" |
| Month with no data | `metrics/page.test.tsx` "teaches what counts when the month has no closed orders"; `TechnicianMonthTable.test.tsx` "teaches what counts when the month has no closed orders, and still lists the roster"; `HoursBarChart.test.tsx` "says the month has no data" (copy differs from spec, see amendments) |
| Numbers in a table | `metrics/page.test.tsx` "plots the six months oldest to newest, and every plotted value is also a table cell" + "plots hours per técnico ... each also in the table"; `mis-numeros/page.test.tsx` "carries every plotted value as text" |
| Reduced motion | UNCOVERED by automated test. Arc's `animated-counter.tsx` uses `useReducedMotion`; `BacklogCounters.tsx` comment documents it. Verified in browser by the orchestrator (WU3 task 3.8) |
| 390px no overflow | UNCOVERED by automated test (jsdom matches no media query / layout). Browser-verified (tasks 2.8, 3.8, 4.4) |
| No money | `metrics/page.test.tsx` "shows no currency amount anywhere"; `mis-numeros/page.test.tsx` "...shows no currency" |
| Role entries (nav) | `nav-items.test.ts` "admin and jefe see Métricas (/metrics) and not Mis números", "técnico sees Mis números ... and not Métricas" |

Non-scenario requirements also covered: 44x44 select/button (`MonthSelect.test.tsx` "keeps both controls at the 44px touch target"); RSC boundary (`page.test.tsx` "passes only plain serializable props", wrapper "is a client module" tests); es-PA formatting (`TrendChart`/`HoursBarChart` tests, `BacklogCounters` test).

Uncovered (browser-only by nature, per AGENTS.md known limits): reduced motion, 390px overflow, chart touch not blocking vertical scroll, theme rendering, LAN-IP hydration. Orchestrator reports these done.

## Text that no longer matches what shipped (amend at archive)

proposal.md
1. Approach/UI: "single-series bar charts, one per series (closed, received, hours per technician)... No grouped/stacked/tooltip charts" -> shipped a 2-series line chart (received vs closed, scrubbing crosshair), a bar chart of hours per technician, animated counters for backlog. design.md already says this.
2. Approach/Access: "new `metrics.read` action (administrador + jefe_taller). Técnico gets `/mis-numeros` only" -> a second action `metrics.self` (técnico only) exists; `/mis-numeros` is técnico-only and denied to admin/jefe.
3. Affected Areas: "`src/components/ui/`" for Arc -> vendored at `src/components/arc/`. Add `charts/arc-scope.module.css`.
4. Rollback Plan mentions removing only `metrics.read`; add `metrics.self`.
5. UI: "month table per technician (default current month)" omits the 12-month `?mes` select; trend is not "last 6 months" for the per-technician table.

design.md
6. Registry row: describes foundation.css as "NOT imported; scoped `arc-scope.module.css` maps tokens" (correct). But Delivery/File Changes omit that the vendored Arc strings were translated to Spanish, the legend was raised to 44px, the bar average is unrounded, and focus rings were restored (task 3.1/3.2 do not record these either). Add one line.
7. Layout: "Pendientes / En curso / En revisión" -> shipped Abiertas / En progreso / Lista para revisión (`BacklogCounters.tsx`).
8. Charts row: "hours per month on Mis números" as a bar chart is right, but Mis números has an hours chart only; closed orders per month are in the table (no closed-orders chart).
9. SQL note "inactive rows shown only with non-zero numbers": correct for shipped code, keep; but spec disagrees (see 12).

tasks.md
10. 2.6 text "Pendientes/En curso/En revisión" and "Sin datos para este mes" -> shipped labels above and empty copy below. 3.1 already records the foundation.css deviation; 5.1 already lists several amendments, add the Arc string/legend/average/focus items and the Mis números chart scope. After archive, mark 5.1 `[x]`.

specs/metrics-dashboard/spec.md (merge into main spec in amended form)
11. Empty States + "Month with no data": copy "Sin datos para este mes" -> table empty copy is "Todavía no hay órdenes cerradas en {mes}. Una orden cuenta cuando pasa a Completada." (`TechnicianMonthTable.tsx:46`). "Sin datos para este mes" survives only as the HoursBarChart default `emptyText`.
12. Technician Productivity: "per active technician" -> an inactive technician is shown when they have numbers that month (`listTecnicos({includeInactive:true})` + shape drops inactive only when all zero); active ones always listed.
13. Charts and Exact Numbers / "Numbers in a table": scenario says each month's "received, closed and hours" in a table on the page; on `/metrics` hours are plotted per technician (table column), per month hours exist only on `/mis-numeros`. Reword per page.
14. Mis números: add that its trend is an hours bar chart only; closed orders per month appear in the table.
15. Missing requirement text: the per-technician table is sorted by closed desc then hours desc, and links the empty roster to Técnicos only for viewers who can manage them (both tested, neither in spec); optional to add.

## Issues

CRITICAL: none.

WARNING
- W1 Reduced-motion and 390px-overflow scenarios have no automated test (jsdom limit); proof rests on the orchestrator's browser checks. Acceptable per AGENTS.md; record browser evidence in the archive note.
- W2 Spec and tasks text diverge from shipped copy/labels (items 7, 10, 11 above); archiving the spec unamended would plant a wrong "Sin datos para este mes" and wrong "active technician" requirement in `openspec/specs/`.
- W3 Proposal contradicts design on charts and access (items 1-2); design.md supersedes, but proposal stays in the archive as written.
- W4 Vendored Arc modifications (translations, 44px legend, unrounded average, focus rings) are undocumented in any artifact, so a future `shadcn add` re-sync would silently revert them.

SUGGESTION
- S1 Add a one-line "vendored Arc deviations" comment/README next to `src/components/arc/` pointing to the changes (guards W4).
- S2 Mutation evidence is claimed in tasks 1.5/2.7/3.7/4.3 but was not re-run here; not required for this verify.

## Next
Amend items above in the delta spec/design/tasks, then sdd-archive (5.1 then 5.2).
