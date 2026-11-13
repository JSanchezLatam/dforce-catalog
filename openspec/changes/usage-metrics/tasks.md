# Tasks: Usage Metrics

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~1,750 (code + tests) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Delivery strategy | auto-chain, feature-branch-chain |
| Tracker | draft PR `feat/usage-metrics` off `main`; each WU PR targets the previous WU's branch |

Every WU: RED first, mutation-verify each new test (red BY NAME), `npm test` + `npx tsc --noEmit` (+ portal gates when `portal/` changes), RDD assess after the commit (owner's standing consent), GGA with `PR_BASE_BRANCH` pinned to the parent branch.

### Suggested Work Units

| WU | Goal | Est. lines | Depends on |
|---|---|---|---|
| WU1 | Workshop table + view endpoint | ~330 | — |
| WU2 | Client counter | ~150 | WU1 |
| WU3 | Portal contract + ingest + tables | ~380 | — (branch after WU2 for the chain) |
| WU4 | Delivery job with watermark | ~320 | WU1, WU3 |
| WU5 | `/support/uso` page + nav | ~400 | WU3 |
| WU6 | Support palette Opción B | ~200 | WU5, owner checkpoint |

## WU1: Workshop table and view endpoint (design §1, §2)
- [x] 1.1 Migration: `usage_daily`, `usage_delivery` (one row, `acked_through` null).
- [x] 1.2 `src/modules/usage/groups.ts`: role → group, pure; unit tests (pantalla refused).
- [x] 1.3 `recordView` service with seam; route `POST /api/usage/view` (400 unreadable/unknown screen, 401, 403, 204); `ROUTE_GUARDS` entry.
- [x] 1.4 e2e on a throwaway DB: increment, two roles merge into `gestion`, 20 concurrent views = 20, day is Panama date.

## WU2: Client counter (design §3)
- [x] 2.1 `UsageCounter` (jsdom): first mount sends one; re-render/StrictMode sends none; `/service-orders/a` → `/b` sends two; query change sends none; unknown route sends none; failed fetch is silent.
- [x] 2.2 Mount in `(app)/layout.tsx` beside `FeedbackProvider`; no function props across the RSC boundary.
- [x] 2.3 Browser at the LAN IP: a navigation records a row; sitting on `/kanban` while it polls adds nothing.

## WU3: Portal contract and ingest (design §4)
- [ ] 3.1 `usage` kind in `portal/src/contract.ts`; parse (exact keys, dates, range ≤31, counts inside range, enum, integers) with unit tests.
- [ ] 3.2 Portal migration: `usage_count`, `usage_coverage`, `usage_screen`.
- [ ] 3.3 `apply` in one transaction: replace in range, cover every day, replace catalog. Tests via `npm run test:portal-sync` (real portal DB): replace-in-range, empty day covered, resend idempotent.

## WU4: Delivery job (design §5)
- [ ] 4.1 `deliver.ts`: windows of ≤31 days from `acked_through + 1` to today; empty days included; catalog from `SCREEN_LABELS`.
- [ ] 4.2 Watermark advances only on 2xx and never past yesterday; failure stops the loop and reports class/status only.
- [ ] 4.3 `worker.ts` hourly schedule (`"17 * * * *"`, Panama tz), registered in `instrumentation-node.ts`.
- [ ] 4.4 `test:portal-sync`: 40-day catch-up = 2 batches, watermark at yesterday; 5xx keeps the watermark.

## WU5: Usage page and nav (design §6, §7)
- [ ] 5.1 `portal/src/usage/queries.ts` (range totals, per day, coverage, newest `received_at`, catalog).
- [ ] 5.2 `portal/app/support/layout.tsx` with the "Comentarios | Uso" nav (`aria-current`, 44px on touch).
- [ ] 5.3 `/support/uso`: range 7/30/90, summary, chart, table, "Sin visitas", stale notice, empty state; copy verbatim from the mockup. Unit tests per spec scenario.

## WU6: Support palette Opción B (design §7, D8)
- [ ] 6.0 **Owner checkpoint:** mockup frame of the real inbox list + detail and the login page under Opción B (status chips: red must not silently mean "Nuevo"); `/users` single-person question (default: show as is). Nothing in WU6 is built before approval.
- [ ] 6.1 Tokens on `.support` (dark-only); `/c` untouched (unit test on the class scope).
- [ ] 6.2 Browser: every support page in both OS themes; contrast of each text pair ≥4.5:1.

## Final integration
- [ ] 7.1 Deploy the PORTAL first (`vercel env`, migration via `DATABASE_URL_UNPOOLED`, `vercel deploy --prod` from `portal/`), then update the workshop PC (`standalone.ps1`, migration).
- [ ] 7.2 Verify from home: `/support/uso` shows the workshop's day.
- [ ] 7.3 sdd-verify, archive.
- [ ] 7.4 Owner request: run the `security-audit` skill (full audit mode) on `main` after this lands.
