# Tasks: Metrics Dashboard

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,250 own (tests ~55%): WU1 ~380, WU2 ~370, WU3 ~280, WU4 ~220; vendored Arc code, `package-lock.json` excluded but reviewed |
| 400-line budget risk | High (WU1 and WU2 sit at the line; WU2 spills if the page and table are not kept thin) |
| Chained PRs recommended | Yes |
| Suggested split | Tracker draft branch `feat/metrics-dashboard` off `main`; WU1 base = tracker; WU2 base = WU1 branch; WU3 base = WU2 branch; WU4 base = WU3 branch; tracker merges to `main` last |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | `months`, `shape`, `queries` (no caller) | PR 1 (base: tracker) | `npx vitest run src/modules/metrics` | `src/e2e/metrics.e2e.test.ts` on throwaway `dforce_e2e` | Revert PR 1; new module only, nothing imports it |
| 2 | `metrics.read`/`metrics.self`, guards, nav, `/metrics` with plain-number counters, table, month select | PR 2 (base: WU1 branch) | `npx vitest run src/modules/metrics src/modules/auth src/modules/layout src/app/api/route-guards.test.ts "src/app/(app)/metrics"` | Playwright at `http://192.168.0.3:3000`, 390 / 768 / desktop | Revert PR 2; queries stay, no route or nav entry |
| 3 | Arc registry, charts, counters, wrappers wired into `/metrics` | PR 3 (base: WU2 branch) | `npx vitest run src/modules/metrics "src/app/(app)/metrics"` | Playwright at `http://192.168.0.3:3000`, light and dark, reduced motion | Revert PR 3; `/metrics` falls back to plain numbers, `motion` removed |
| 4 | `/mis-numeros` (técnico only) | PR 4 (base: WU3 branch) | `npx vitest run src/modules/metrics "src/app/(app)/mis-numeros" src/app/api/route-guards.test.ts` | e2e técnico `WHERE` rows; Playwright as técnico at `http://192.168.0.3:3000` | Revert PR 4; admin dashboard unaffected |

Rule for every task pair: RED test, confirm red BY NAME, GREEN, then mutation-verify (revert the fix, the named test goes red). Fixtures match the wire (`sum`/`count` cast to `::int`; no `number` over a string wire). E2E rows run on a throwaway `dforce_e2e`, never the dev DB. No migration. Gates per PR: `npx tsc --noEmit`, `npm test`, `npm run lint` (0 errors, 13 warnings, no new), `gga run --pr-mode --diff-only` with `PR_BASE_BRANCH` pinned to the previous branch. Owner standing consent covers all Gentle AI reviews. Threat matrix: N/A (design). Pages cross a Server Component boundary and Arc may hold portals: a green suite is not evidence, the browser at the LAN IP is.

## WU1: Months, shape, queries (PR 1)

- [x] 1.1 RED `src/modules/metrics/months.test.ts`: month keys across a year boundary (Jan 2027 window starts Aug 2026 for 6, Feb 2026 for 12); current key from `toWorkshopDateKey` at 04:59Z vs 05:00Z on the 1st; `parseMes` accepts only keys in the 12-key list, rejects `2019-01`, `garbage`, `2026-13`, arrays, undefined (all fall back to current). GREEN `months.ts`.
- [x] 1.2 RED `shape.test.ts`: zero-fill against a key list (July present with 0), minutes to hours (270 min = 4.5), backlog zero-fill for all three statuses, inactive technicians dropped when all numbers are 0, shared order credits each assignee while the closed total stays 1. GREEN `shape.ts`.
- [x] 1.3 `queries.ts` (Drizzle builder, `sql<string>` month fragment, `'America/Panama'` via `sql.raw`, `::int` casts): `closedByTecnicoMonth`, `minutesByTecnicoMonth` (optional `tecnicoId`), `receivedByMonth`, `closedByMonth`, `backlogByStatus`. RED e2e first (1.4), GREEN here.
- [x] 1.4 RED `src/e2e/metrics.e2e.test.ts` (`dforce_e2e`): order completed 04:59Z Oct 1 counts September and 05:00Z counts October; `fecha` bucketed as-is; two assignees give 1 each and `closedByMonth` 1; cancelled only in `receivedByMonth`; `tecnicoId` filter returns only own rows for both closed and minutes; lower bound excludes older rows; backlog excludes done/cancelled. GREEN: fix real-SQL defects.
- [x] 1.5 Mutation-verify 1.1-1.4 by name (bucket in UTC, drop `status = 'done'`, drop the `tecnico_id` filter, count `ids` instead of `count(*)`, bind the zone as a param).

## WU2: Policy, nav, `/metrics` with plain numbers (PR 2)

- [x] 2.0 Impeccable skill design pass for the dashboard page, BEFORE any UI in 2.4-2.6: settle direction (hierarchy, density at 390/768/desktop, how charts, counters and table sit against the shadcn neutral palette, light and dark). Record it in the WU2 PR description; WU3 and WU4 follow it. Do not restyle shipped screens.
- [x] 2.1 RED `policy.test.ts`: `metrics.read` true for administrador and jefe_taller, false for tecnico; `metrics.self` true for tecnico only; existing grants unchanged. GREEN `src/modules/auth/policy.ts`.
- [x] 2.2 RED `route-guards.test.ts`: `/metrics` page maps to `metrics.read`, `/mis-numeros` to `metrics.self`; no unguarded entry. GREEN guard list. WU2 registers `/metrics` only: a guard entry with no page fails the completeness test, so `/mis-numeros` and the `metrics.self` mapping land in WU4, and `metrics.self` is in the "reachable" exempt list until then.
- [x] 2.3 RED `nav-items` test: jefe/admin see "Métricas" (`/metrics`) and not "Mis números"; técnico sees "Mis números" and not "Métricas" (including admin does not see two entries). GREEN `src/modules/layout/nav-items.ts`, `src/components/app-sidebar.tsx` (icon keys `metrics`, `my-metrics`).
- [x] 2.4 RED `TechnicianMonthTable.test.tsx` (counters labelled Abiertas / En progreso / Lista para revisión per the design pass, in `BacklogTiles`): columns Técnico / Órdenes cerradas / Horas; 3 closed and 270 min render "3" and "4.5"; footnote "Una orden con varios técnicos cuenta para cada uno" visible; table scrolls inside its own container. GREEN `TechnicianMonthTable.tsx`.
- [x] 2.5 RED `MonthSelect` test: native `<select>` with 12 options in a GET form with a submit button, current month selected, `min-h-11 min-w-11` on select and button. GREEN `src/modules/metrics/MonthSelect.tsx` (no client JS).
- [x] 2.6 RED `src/app/(app)/metrics/page.test.tsx` (`render(await Page({searchParams}))`, queries mocked, fixtures match the wire): técnico gets the shared no-permission screen; admin/jefe see counters as plain numbers "Pendientes"/"En curso"/"En revisión", the table, and a 6-month received/closed table; `?mes=2026-08` selects August; `?mes=garbage` selects current; empty month shows "Sin datos para este mes"; no currency amount. GREEN `page.tsx`.
- [x] 2.7 Mutation-verify 2.1-2.6 by name (grant `metrics.read` to tecnico, trust `?mes` unvalidated, drop the footnote, drop `min-h-11`, show "Mis números" to admin).
- [ ] 2.8 Playwright at `http://192.168.0.3:3000` (LAN IP, not localhost) as administrador and técnico at 390, 768 and desktop: console clean (RSC boundary, hydration); no horizontal overflow at 390; select and button >=44x44 measured; técnico sees denial screen on `/metrics`.

## WU3: Arc charts (PR 3)

- [ ] 3.1 Install: add `"registries": {"@uiarc": "https://uiarc.dev/r/{name}.json"}` to `components.json`; run `npx shadcn@latest add @uiarc/line-chart @uiarc/bar-chart @uiarc/animated-counter`; confirm `motion` is added to `package.json` and `lucide-react` was already present; add `import "@/components/arc/foundation.css"` at the app root (`src/app/layout.tsx`).
- [ ] 3.2 Review the vendored code (excluded from the line budget, still reviewed): grep `src/components/arc` and `node_modules/motion` for `randomUUID|crypto.subtle|clipboard|serviceWorker|showSaveFilePicker|mediaDevices|geolocation`; expected none (rAF, ResizeObserver, matchMedia only). Record the result in the PR description. Any hit needs an insecure-context fallback or the component is dropped.
- [ ] 3.3 Theme check: confirm `foundation.css` does not redefine or override any shadcn token in `src/app/globals.css` (`--background`, `--foreground`, `--primary`, `--border`, ...) in `:root` or `.dark`; diff computed styles of an existing page before and after the import. If it overrides, scope the import to the metrics layout, not the root. Verify in the browser that every chart, axis, crosshair and counter reads in both light and dark.
- [ ] 3.4 Confirm whether `animated-counter` renders decimals (hours). If not: counters only for the integer backlog, hours as text. Record the answer in `design.md` Open Questions.
- [ ] 3.5 RED wrapper tests (`charts/*.test.tsx`; Arc mocked at the module boundary, props asserted): `TrendChart` passes two series (Órdenes recibidas, Órdenes cerradas) for 6 months in order; `HoursBarChart` passes `{key,label,value}` for the selected month; `BacklogCounters` passes `locale="es-PA"` and the three labels; each wrapper is `"use client"`, owns `formatValue`, and takes only plain JSON props (no function prop from the page); empty data renders "Sin datos para este mes", not an empty chart. GREEN `src/modules/metrics/charts/{TrendChart,HoursBarChart,BacklogCounters}.tsx`.
- [ ] 3.6 RED `page.test.tsx` additions: every plotted value is still present as text in a table (received, closed, hours per month); wrappers wired in beside the table. GREEN `metrics/page.tsx`.
- [ ] 3.7 Mutation-verify 3.5-3.6 by name (pass `formatValue` from the page, drop `locale`, drop a series, remove the table behind the chart).
- [ ] 3.8 Playwright at `http://192.168.0.3:3000` at 390, 768, desktop, light and dark: console clean (hydration, RSC); vertical scroll works when swiping over a chart at 390; no horizontal overflow; with `prefers-reduced-motion: reduce` no count-up and the final value shows; chart and table side by side at `lg`; charts correct in both themes.

## WU4: Mis números (PR 4)

- [ ] 4.1 RED e2e rows in `metrics.e2e.test.ts`: técnico A and B both with closed orders and hours, `tecnicoId` of A returns only A (closed and minutes, per month); unlinked user resolves no id. GREEN: fix real-SQL defects.
- [ ] 4.2 RED `src/app/(app)/mis-numeros/page.test.tsx`: id resolved from `findTecnicoByUserId(session.user.id)`; `?tecnicoId=<B>` and `?mes` for B are ignored and queries are called with A's id; unlinked técnico sees "Todavía no estás en la lista de técnicos" with no error; administrador and jefe_taller get the shared no-permission screen; closed orders and hours shown with the month select and hours-per-month bar chart; no currency. GREEN `mis-numeros/page.tsx`.
- [ ] 4.3 Mutation-verify 4.1-4.2 by name (read `tecnicoId` from `searchParams`, drop the `WHERE`, grant `metrics.self` to administrador).
- [ ] 4.4 Playwright at `http://192.168.0.3:3000` as técnico at 390, 768 and desktop: console clean, no overflow, select >=44x44, own numbers only, `?tecnicoId=` forged URL shows own data.

## Spec archive notes

- [ ] 5.1 At archive, merge `metrics-dashboard` as a NEW main spec (every block ADDED, no existing spec modified); check for duplicates after the mechanical apply. Spec and design were reconciled before tasks: `/mis-numeros` técnico-only via `metrics.self`, 12-month select with validated `?mes`, line + bar + counter charts. `proposal.md` still describes single-series bar charts and `metrics.read`-only access, and is superseded by `design.md` on those points.
- [ ] 5.2 Follow-ups, not in scope: average time to close, orders by `categoria`, vencimientos contacted per month, cancellation rate, CSV/PDF export, custom date ranges, a trend window longer than 6 months. Owner to confirm the productivity definition (closed orders + hours) came from the client.
