# Design: Metrics Dashboard

## Technical Approach

One read-only module `src/modules/metrics/` (SQL in `queries.ts`, pure shaping in `shape.ts`), two RSC pages that authorize, query, shape and pass plain JSON to thin `"use client"` chart wrappers around Arc components. No migration, no writes.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Query style | Drizzle builder + `sql<string>` month fragments, `count(*)::int` / `sum(...)::int` | `db.execute` raw strings | Matches `technicians/queries.ts`; the casts make the `number` type true (node-postgres returns bigint as string) |
| Time zone in SQL | `'America/Panama'` inlined with `sql.raw` (constant) | bind param | A bound zone becomes `$1` in SELECT and `$2` in GROUP BY, and Postgres rejects the mismatch; it is a constant, not input |
| Window | Trend (received/closed): last 6 workshop months. Per-technician queries: last 12 (select range). Keys built in TS from `toWorkshopDateKey(now)`; lower bound only | Bucketing every row | `completed_at >= ('YYYY-MM-01'::timestamp AT TIME ZONE 'America/Panama')` stays sargable; future rows cannot exist |
| Zero-fill | In `shape.ts` against the month-key list | `generate_series` LEFT JOIN | Pure, unit-testable, one place for every series |
| Month table | `?mes=YYYY-MM` validated against the last 12 month keys, else current Panama month; native `<select>` of those 12 months (auto-submitting GET form needs JS, so include a submit button, 44px) | Free date range; month links | Proposal scopes custom ranges out; native select is the cheapest 12-option control |
| Técnico access | New `metrics.self` (técnico only) + `metrics.read` (admin, jefe) | `/mis-numeros` as session-only | `getNavGroups` filters only by a positive action; without it admins see two entries. A jefe cannot be roster-linked (`assertLinkable`), so técnico-only is exact |
| Técnico scope | `tecnicoId` from `findTecnicoByUserId(user.id)` passed to the same queries as an optional filter | Separate queries; id from URL | One SQL path to e2e; null link renders an empty state |
| Charts | Line chart: received vs closed per month (2 series). Bar chart: hours per technician for the selected month; hours per month on Mis números. Animated counters: backlog by status | Proposal's three single-series bar charts | Verified Arc line chart is multi-series with a scrubbing crosshair, so the comparison sits in one chart. Exact numbers always live in the table |
| RSC boundary | Wrappers in `src/modules/metrics/charts/*.tsx` own `formatValue` and `locale="es-PA"`; pages pass arrays of `{key,label,value(s)}` | Passing `formatValue` from the page | A function across the RSC boundary breaks the page (shipped before) |
| Registry | Add `"registries": {"@uiarc": "https://uiarc.dev/r/{name}.json"}` to `components.json` (verified on uiarc.dev/docs/installation; `registries` is `{}` today), `npx shadcn@latest add @uiarc/line-chart @uiarc/bar-chart @uiarc/animated-counter`; output in `src/components/arc/`; deps `motion` + `lucide-react` (already present). Arc uses CSS modules + CSS variables and ships `foundation.css`, which is NOT imported (it redefines shadcn's `--background/--foreground/--border/--accent` app-wide and disables focus outlines); a scoped `arc-scope.module.css` maps the tokens Arc reads onto the shadcn ones | Hand-copy | The CLI pins `motion` in `package.json`; foundation.css must not override the shadcn tokens in `globals.css` (checked in WU3) |

## SQL (pattern)

```sql
-- closed per technician; PK (orden_id, tecnico_id) => one credit per assignee
SELECT ot.tecnico_id, to_char(date_trunc('month', o.completed_at AT TIME ZONE 'America/Panama'), 'YYYY-MM') AS mes, count(*)::int AS n
FROM orden_tecnico ot JOIN orden_servicio o ON o.id = ot.orden_id
WHERE o.status = 'done' AND o.completed_at >= (:from::timestamp AT TIME ZONE 'America/Panama') [AND ot.tecnico_id = :t]
GROUP BY 1, 2;
```

- `receivedByMonth`: same bucket on `created_at`, no status filter (cancelled counts here only).
- `closedByMonth`: `status = 'done'`, bucket `completed_at`.
- `minutesByTecnicoMonth`: `to_char(fecha,'YYYY-MM')`, `fecha >= :from::date`, `[tecnico_id = :t]` — uses `orden_linea_tecnico_fecha_idx`.
- `backlogByStatus`: `status IN ('open','in_progress','ready_for_review')` grouped, zero-filled.
- Names: `listTecnicos({ includeInactive: true })`; inactive rows shown only with non-zero numbers.

## Data Flow

    page.tsx (RSC) ── can() ──> PermissionDenied
         │ Promise.all(queries)          shape.ts (zero-fill, minutes→hours)
         └──> Postgres ──> rows ──> plain JSON ──> charts/*.tsx ("use client") ──> Arc

## File Changes

| File | Action |
|---|---|
| `src/modules/metrics/{queries,shape,months}.ts` + tests | Create |
| `src/modules/metrics/charts/{TrendChart,HoursBarChart,BacklogCounters}.tsx` | Create |
| `src/modules/metrics/TechnicianMonthTable.tsx` | Create — Técnico / Órdenes cerradas / Horas, footnote "Una orden con varios técnicos cuenta para cada uno" |
| `src/app/(app)/metrics/page.tsx`, `src/app/(app)/mis-numeros/page.tsx` + tests | Create |
| `src/components/arc/**`, `components.json`, `package.json` | Create/Modify (CLI output) |
| `src/modules/auth/policy.ts`, `route-guards.test.ts` | Modify — two actions; `/metrics` → `metrics.read`, `/mis-numeros` → `metrics.self` |
| `src/modules/layout/nav-items.ts`, `src/components/app-sidebar.tsx` | Modify — "Métricas", "Mis números" in CRM; icon keys `metrics`, `my-metrics` |
| `src/e2e/metrics.e2e.test.ts` | Create |

## Layout

390: one column — counters stacked 1→3 cols at `sm`, line chart full width, month `<select>` (44px), 3-column table without horizontal scroll, bar chart. 768: counters 3-up. Desktop: chart and table side by side at `lg`. Copy Spanish (`Órdenes recibidas`, `Órdenes cerradas`, `Horas`, `Pendientes`, `En curso`, `En revisión`).

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | month keys across year boundary, zero-fill, minutes→hours, `?mes` validation | `shape.test.ts`, `months.test.ts` |
| Component | pages: denied/empty-link/rendered; Spanish strings; table numbers | `render(await Page(...))`, queries mocked |
| E2E (real SQL) | every query: 04:59Z vs 05:00Z on the 1st (Panama boundary), `fecha` month, two assignees → 1 each and closed total 1, cancelled only in received, técnico `WHERE` returns only own rows, backlog zero-fill | `src/e2e/metrics.e2e.test.ts`, `dforce_e2e` |
| Browser | 390/768/1280 at `http://<lan-ip>:3000`, console clean (hydration), reduced motion | Playwright script, not localhost |

Insecure context: grep `src/components/arc` and installed `motion` for `randomUUID|crypto.subtle|clipboard|serviceWorker` at install; expected none (rAF, ResizeObserver, matchMedia only).

## Delivery (chained PRs off `feat/metrics-dashboard`)

| WU | Content | Est. lines |
|---|---|---|
| 1 | `months`/`shape`/`queries` + unit + e2e | ~380 |
| 2 | Policy, route-guards, nav, `/metrics` with counters as plain numbers + table | ~350 |
| 3 | Registry + Arc + `motion` + wrappers wired in | ~250 own (vendored Arc counted apart) |
| 4 | `/mis-numeros` + tests | ~200 |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required.

## Open Questions

- [x] uiarc registry URL template: resolved (see Registry row).
- [x] Whether `animated-counter` renders decimals (hours): yes, it has a `decimals` prop (Intl.NumberFormat fraction digits). Not needed: counters are the integer backlog only and hours stay in the table and bar chart.
- [x] Month table range: resolved, last 12 months via native select; trends stay 6.
