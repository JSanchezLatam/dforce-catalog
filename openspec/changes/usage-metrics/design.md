# Design: Usage Metrics

Specs: `specs/usage-metrics/spec.md`, `specs/support-inbox/spec.md`. Layout and copy: `mockup/index.html` (palette Opción B).

## Decisions

| # | Decision | Why | Rejected |
|---|---|---|---|
| D1 | Count on the CLIENT, on pathname change, in a component mounted once in `(app)/layout.tsx` beside `FeedbackProvider` | The proxy matcher (`src/proxy.ts:16`) sees `/api/*` (the kanban polls `/api/kanban`), prefetches and RSC refreshes (`usePollWhileActive` → `router.refresh()`); page-level counting sees refreshes too. Only a pathname change is a navigation | Proxy counting; counting in each `page.tsx` |
| D2 | Server whitelists the screen against `SCREEN_LABELS` keys; group comes from `requireSession` | Mirrors `feedback/service.ts:7`. Any other string would reach the table and the portal | Trusting the client's pattern or role |
| D3 | Day computed in SQL: `(now() AT TIME ZONE 'America/Panama')::date`; one `INSERT … ON CONFLICT DO UPDATE SET count = count + 1` | Same clock as `metrics/queries.ts`; atomic under concurrency | App-side date (`toWorkshopDateKey`) — a second clock to keep in step |
| D4 | Absolute daily totals + a watermark of the last acknowledged CLOSED day; batches of ≤31 days declaring `from`/`to` | Stateless retry, idempotent on the portal, any outage length catches up, and the portal can tell "zero" from "not arrived" | Per-view outbox (feedback's), fixed N-day window |
| D5 | Hourly delivery, `boss.schedule(..., "17 * * * *", {}, { tz: "America/Panama" })` | Fresh enough for a support page; off the :00 crowd | Every minute (the feedback sweeper's cadence: no one waits on these numbers) |
| D6 | The workshop sends its screen catalog in every batch; the portal keeps only the latest | "Sin visitas" must reflect the workshop's RUNNING version, which often lags `main` | Importing `SCREEN_LABELS` into the portal |
| D7 | No toast, no error UI for a view | A view is not an operator mutation; the toast rule (AGENTS.md, 2026-09-13) covers actions the operator takes. Recorded here so review does not flag it | Toasting or retrying |
| D8 | Palette as tokens on a `.support` wrapper in a new `portal/app/support/layout.tsx`; dark-only | Scopes to `/support` without touching `:root`, so `/c` is untouched (`portal/app/globals.css:2,26`) | Editing `:root` |
| D10 | The `/support/uso` chart is hand-made inline SVG, not Arc UI | Owner 2026-11-13: one simple chart; Arc lives only in the workshop app (`src/components/arc/`, brings `motion`) and the portal has neither. Revisit Arc when the support area presents more metrics | Copying Arc + `motion` into `portal/` |
| D9 | No special case for single-person screens (`/users` is administrador-only) | Owner-default; flagged at the palette checkpoint | Hiding the split per screen |

## 1. Workshop data

`usage_daily (day date, screen text, role_group text CHECK IN ('gestion','tecnico'), views integer NOT NULL, PRIMARY KEY (day, screen, role_group))`.
`usage_delivery (id smallint PRIMARY KEY CHECK (id = 1), acked_through date)` — one row; `NULL` means nothing acknowledged yet (start from the oldest `usage_daily.day`).

Both additive; one migration.

## 2. View endpoint — `POST /api/usage/view`

Body `{ screen: string }`. Parse failure or unknown key → 400 (the repo-wide rule from #242). `requireSession` → 401 without a session. Role → group map in `src/modules/usage/groups.ts` (pure); `pantalla` → 403. Screen not in `SCREEN_LABELS` → 400. Success → 204. `ROUTE_GUARDS` entry: session-only, `POST`.

Service: `recordView(screen, group, deps?)` with the repo's injected-seam pattern; its real branch is the upsert, so it gets e2e rows (the seam limit).

## 3. Client counter — `UsageCounter`

`"use client"`; `const path = usePathname()`; a `useRef` holds the last counted pathname; in an effect, if `path !== last.current`, set it and `fetch("/api/usage/view", { method: "POST", keepalive: true, body: JSON.stringify({ screen: routeOf(path) }) }).catch(() => {})`. Only when `routeOf(path)` is a `SCREEN_LABELS` key. Renders `null`. Mounted next to `FeedbackProvider` in `(app)/layout.tsx` (a Server Component passing no function prop — the RSC boundary trap).

## 4. Contract and portal ingest

`portal/src/contract.ts` gains `{ kind: "usage"; from: string; to: string; screens: { pattern: string; label: string }[]; counts: { day: string; screen: string; group: "gestion" | "tecnico"; views: number }[] }`. `parse.ts`: exact keys, ISO dates, `from ≤ to`, range ≤ 31 days, every count's day within the range, non-negative integer views, group in the enum. `apply.ts`, one `db.transaction` (`node-postgres`, `portal/src/db/client.ts`): delete counts in `[from, to]`, insert the batch's counts, upsert one `usage_coverage (day, received_at = now())` per day of the range, replace `usage_screen`.

Portal tables: `usage_count (day, screen, role_group, views, PK(day, screen, role_group))`, `usage_coverage (day PK, received_at timestamptz)`, `usage_screen (pattern PK, label)`.

## 5. Delivery job — `src/modules/usage/deliver.ts`, `worker.ts`

Run: read `acked_through`; `from = acked_through + 1` (or the oldest `usage_daily.day`; nothing to send if the table is empty); loop in 31-day windows up to today (DB date): build the body, `sendToPortal`; on 2xx set `acked_through = min(window.to, today - 1)`; on any throw stop the loop, report to Sentry with class/status only, leave the watermark. Registered in `src/instrumentation-node.ts` like `registerPortalReconcile`.

**Deploy order:** the portal (migration + code) before the workshop. An old portal answers 4xx to the unknown kind; the watermark then stays put, which is correct, but Sentry logs it every hour.

## 6. Portal usage page — `/support/uso`

Server component behind the support guard. Queries in `portal/src/usage/queries.ts`: totals per screen×group and per day over the range; covered days; newest `received_at`; latest catalog. Range from `?r=7|30|90`, default 30. Stale when `now() - max(received_at) > 1 day`. Chart: inline SVG as in the mockup; numbers in the table.

## 7. Support nav and palette

`portal/app/support/layout.tsx` wraps every support page in `.support` (tokens of Opción B, dark-only) and renders the nav (D8). The login page gets the palette but not the nav. Inbox status chips are recolored within the palette; the red never marks a status as "Nuevo" without the owner seeing it first (palette checkpoint, tasks WU6).

## Testing strategy

Unit: parse, groups, counter dedupe (jsdom, mocked fetch), page states. e2e (throwaway DB): upsert concurrency, watermark catch-up, portal replace-in-range and coverage. Every new test mutation-verified. Browser at the LAN IP: a navigation records a view, the kanban poll does not.
