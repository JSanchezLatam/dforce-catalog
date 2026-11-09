# Tasks: In-App Feedback

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2,780 across 9 PRs (tests counted, drizzle snapshots excluded); per-PR 200-400 |
| 400-line budget risk | High (WU5 ~400 and WU4 ~390 sit on the budget; WU7 ~380) |
| Chained PRs recommended | Yes |
| Suggested split | WU1 → WU2 → WU3 → WU4 → WU5 → WU6 → WU7 → WU8 → WU9 |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain (tracker `feat/in-app-feedback` → main) |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

Branches: WU1 targets `feat/in-app-feedback`; each later branch targets the previous WU branch: `feat/in-app-feedback-wu1-schema-service`, `-wu2-send-route`, `-wu3-portal-ingest`, `-wu4-outbox-delivery`, `-wu5-dialog-sidebar`, `-wu6-my-feedback`, `-wu7-support-login`, `-wu8-inbox-list`, `-wu9-inbox-detail`. Tracker merges to main last. No branch name contains main/master/develop.

Conventions for every WU: Strict TDD (RED confirmed failing BY NAME, then GREEN). Mutation-verify every fix: revert it, name the red test; a test that stays green is a placebo, fix or delete it. Fixtures match the wire (typed as `IngestBody`); no secure-context APIs; 44x44 on actions; Spanish copy verbatim from the specs/mockup. Value-bearing SQL (claim, sweeper WHERE, ON CONFLICT, throttle upsert, mark-read, `listOwnFeedback`) needs an e2e row: a green unit run proves zero real SQL. Last tasks of each WU: gates (`npm test`, `npx tsc --noEmit`, `npm run lint` = 0 errors, 13 warnings; portal WUs also `cd portal && npm test && npx tsc --noEmit && npm run lint`), mutation check, `gga run --pr-mode --diff-only` (pin `PR_BASE_BRANCH` to the previous WU branch), PR to the previous WU branch. Engram not written by this phase (no `mem_save`); the orchestrator mirrors to `sdd/in-app-feedback/tasks`.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Workshop table, categories, screen labels, service (~300) | PR 1 → tracker | `npx vitest run src/modules/feedback` | e2e CHECK/insert (WU4 file; here: migration applied to a throwaway DB) | schema, migration 0037, `modules/feedback` |
| 2 | Policy + store-only POST route (~220) | PR 2 → WU1 | `npx vitest run src/modules/auth src/app/api/feedback` | curl 401/403/201 against dev | `policy.ts` cells, route |
| 3 | Portal contract, ingest, migration 0002 (~340) | PR 3 → WU2 | `cd portal && npx vitest run src/contract src/ingest src/db` | `cd portal && npm run test:e2e` (ingest.e2e) | portal contract/ingest/schema, 0002 |
| 4 | Transport timeout, deliver, sweeper, worker (~390) | PR 4 → WU3 | `npx vitest run src/modules/feedback src/modules/portal-sync src/instrumentation-node` | `src/e2e/feedback.e2e.test.ts`; `npm run test:portal-sync` | `feedback/{deliver,worker}`, transport 4th param |
| 5 | Provider, dialog, sidebar item (~400) | PR 5 → WU4 | `npx vitest run src/modules/feedback src/components/app-sidebar` | Browser at LAN IP | provider/dialog, layout, sidebar item |
| 6 | "Mis comentarios" card (~200) | PR 6 → WU5 | `npx vitest run src/modules/feedback/MyFeedbackCard.test.tsx "src/app/(app)/account"` | Browser at LAN IP | card, account page |
| 7 | Portal login, session, throttle, guard (~380) | PR 7 → WU6 | `cd portal && npx vitest run src/support src/env-isolation.test.ts` | `portal` e2e throttle; Vercel preview | `portal/src/support`, login/logout routes |
| 8 | Inbox list, filters, delay flag (~350) | PR 8 → WU7 | `cd portal && npx vitest run src/support` | Vercel preview 1280/820/390 | queries, format, list page |
| 9 | Detail, mark-read, status, note (~300) | PR 9 → WU8 | `cd portal && npx vitest run src/support app/api/support` | support.e2e rows; Vercel preview | detail, PATCH route |

WU3 and WU1/WU2 touch disjoint trees (portal vs workshop) and may be written in parallel by subagents; branches stay chained. WU7 follows WU3 (schema, migration order). WU5 follows WU2 (policy Action).

## WU1: Workshop schema and service (design §1, D4)

- [x] 1.1 RED `screen-labels.test.ts`: mapped (`/service-orders/[id]` → "Orden de servicio — Detalle"), unmapped falls back to raw route, query/fragment stripped, completeness walk over `src/app/(app)/**/page.tsx` fails on an unmapped page (specs "Mapped route", "Unmapped route"). GREEN `screen-labels.ts`, `categories.ts`.
- [x] 1.2 RED `service.test.ts` (injected seams): `createFeedback` stores author/role from args, trims, 2000 ok / 2001 rejected (spec "Exactly 2000 accepted"); `listOwnFeedback` newest first. GREEN `service.ts`.
- [x] 1.3 GREEN `schema.ts` `feedback` table + `feedbackCategoryEnum` + CHECK + both indexes; `npm run db:generate -- --name feedback` → `0037_feedback.sql`.
- [x] 1.4 Mutation-verify 1.1-1.2 (drop trim, off-by-one on 2000, drop fallback); gates; GGA; PR.

## WU2: Policy and store-only route (design §4)

- [x] 2.1 RED `route-guards.test.ts` + policy test: `feedback.send` true for tecnico/jefe_taller/administrador, false for pantalla (spec "Pantalla cannot send"). GREEN `policy.ts` four maps + `ROUTE_GUARDS["/api/feedback"]` (same PR or `:217-237` fails).
- [x] 2.2 RED `api/feedback/route.test.ts`: 401 no session, 403 pantalla, 400 missing/unknown category/blank text, 2000 vs 2001, author from session not body, 201 `{id, outcome:"queued"}`, nothing persisted on 4xx. GREEN `route.ts`.
- [ ] 2.3 Mutation-verify (trust body author, skip `can`, drop length check); gates; GGA; PR.

## WU3: Portal contract and ingest (design §2, §1 portal)

- [ ] 3.1 RED `parse` tests: feedback accepted; extra key (`receivedAt`/`status`), missing field, bad role/category, empty/2001 text, non-UUID id → 400; unknown kind → 400; customer bodies unchanged; `contract-import.test.ts` stays green. GREEN `contract.ts` 4th member, `parse.ts` `build()` branch.
- [ ] 3.2 RED `applyIngest` feedback: insert, status `nuevo`, empty note, `received_at` from portal clock, duplicate keeps first row, unsigned → 401. GREEN `apply.ts` `onConflictDoNothing`.
- [ ] 3.3 GREEN `portal/src/db/schema.ts` `support_feedback` + `support_login_throttle`; `npx drizzle-kit generate --name support_inbox` → `0002_support_inbox.sql`.
- [ ] 3.4 E2E `portal/e2e/ingest.e2e.test.ts`: duplicate id → 1 row untouched (Resuelto + note + different text), concurrent duplicates → 1 row both 2xx, `received_at` from portal clock.
- [ ] 3.5 Mutation-verify (remove `DO NOTHING`, accept `receivedAt`); gates; GGA; PR.

## WU4: Outbox delivery (design §3)

- [ ] 4.1 RED `transport.test.ts`: `timeoutMs` 4th param, default unchanged, `PortalServerError.status`, existing 2-arg callers byte-identical. GREEN `transport.ts`.
- [ ] 4.2 RED `deliver.test.ts`: unconfigured → `"queued"` pre-claim; 2xx sets `delivered_at`; 4xx/5xx/timeout/network leave NULL; `last_error` has class+status, no text; Sentry per failure (id, status, attempt, no text/secret; error vs warning); backoff `min(2^(n-1),60)` monotone and capped; already delivered → no request; same `id` every attempt; recovery after 4xx; never throws; inline timeout 5000. GREEN `deliver.ts`.
- [ ] 4.3 RED `worker.test.ts`: sweeper returns before query if unconfigured, ≤25 per run oldest first, `singletonKey: id`, `retryLimit 0`, `localConcurrency 1`, cron `* * * * *` tz America/Panama; `instrumentation-node` registers it. GREEN `worker.ts`, `instrumentation-node.ts`; route calls `deliverFeedback(id, 5_000)`.
- [ ] 4.4 E2E `src/e2e/feedback.e2e.test.ts`: insert + CHECK (2001 fails); concurrent claims → one winner; not-yet-due row → none; sweeper due-only/oldest/LIMIT; delivered UPDATE guard; `listOwnFeedback` WHERE (A vs B).
- [ ] 4.5 Confirm `portal-sync` and contract tests pass unchanged ("Customer sync untouched").
- [ ] 4.6 Mutation-verify (drop `delivered_at IS NULL` from claim, drop lease, drop cap); gates; GGA; PR.

## WU5: Dialog, provider, sidebar (design §5, D5, D6)

- [ ] 5.1 RED `FeedbackDialog.test.tsx`: nothing preselected, placeholder per category, both missing messages, whitespace text `aria-invalid`, counter 1799/1800 amber, author line "jperez (Técnico)", context read-only, locked while sending, roles/`aria-pressed`, 44px classes. GREEN `FeedbackDialog.tsx` (D5 composition, raw textarea).
- [ ] 5.2 RED toast tests: delivered → success, queued → info, store failure → inline error text kept, toast raised before a throwing `refresh`. GREEN submit path (copy `OrderStatusControls.tsx:111-142`).
- [ ] 5.3 RED `app-sidebar.test.tsx`: item above user card, opens dialog, rail tooltip + name, mobile sheet closes and dialog stays mounted, absent without `feedback.send`; existing sidebar tests unchanged. GREEN `FeedbackProvider.tsx`, `(app)/layout.tsx` (strings only), `app-sidebar.tsx`.
- [ ] 5.4 Mutation-verify; gates; GGA; PR.
- [ ] 5.5 BROWSER (LAN IP, second machine; Chrome device extension): 1280/820/390, sheet closes and dialog stays, rail tooltip, measured 44px, console free of RSC/hydration errors, queued toast with portal unreachable, light+dark.

## WU6: "Mis comentarios" (specs feedback, last requirement set)

- [ ] 6.1 RED `MyFeedbackCard.test.tsx`: newest first, badges Enviado / Pendiente de envío + offline text, empty state, no "Respondido", button opens shared dialog. GREEN `MyFeedbackCard.tsx`, `account/page.tsx` via `listOwnFeedback` gated by `can`.
- [ ] 6.2 Mutation-verify; gates; GGA; PR.
- [ ] 6.3 BROWSER (LAN IP): `/account` card, pending flips to Enviado after reconnection, no duplicate in portal.

## WU7: Portal login, session, throttle (design §6)

- [ ] 7.1 RED `session.test.ts`: sign/verify, tamper, expired, regex precheck, unset env fails closed. GREEN `session.ts` `requireSupport()`.
- [ ] 7.2 RED `throttle.test.ts` + login handler: 5 failures lock even correct password, expiry, success resets, cookie `httpOnly/secure/sameSite=strict`, "Contraseña incorrecta.", logout clears. GREEN `throttle.ts`, `login`/`logout` routes, login page.
- [ ] 7.3 RED `guard.test.ts` route inventory; `env-isolation.test.ts` lists both vars; extend `headers.test.ts`. GREEN.
- [ ] 7.4 E2E `portal/e2e/support.e2e.test.ts`: throttle upsert, window reset, success delete, shared across instances.
- [ ] 7.5 Mutation-verify (compare non-constant-time, skip lock check); gates; GGA; PR.

## WU8: Inbox list (specs support-inbox)

- [ ] 8.1 RED `format.test.ts`: delay flag at 10:00 no, 10:01 yes, 0 no; `dd/MM/yyyy HH:mm` America/Panama. GREEN `format.ts`.
- [ ] 8.2 RED `queries.test.ts` + page tests: filters AND in SQL, counts "Todos (5)", newest first, empty state, no-results + "Limpiar filtros", list render does not mark read. GREEN `queries.ts`, `app/support/page.tsx`, list/filter components.
- [ ] 8.3 E2E `support.e2e`: filter WHERE and `GROUP BY` counts.
- [ ] 8.4 Mutation-verify; gates; GGA; PR.

## WU9: Inbox detail (D8)

- [ ] 9.1 RED: `?id=` marks only `nuevo` → `leido` (leido/resuelto untouched, no `id` no mark, `prefetch={false}`). GREEN page + mark-read UPDATE.
- [ ] 9.2 RED PATCH route tests: 401 no session, exact keys, bad status 400, note 2001 400, note replaces. GREEN `app/api/support/feedback/[id]/route.ts`, status/note editor ("Nota guardada.").
- [ ] 9.3 E2E `support.e2e`: mark-read only from nuevo, PATCH UPDATE.
- [ ] 9.4 Mutation-verify; gates; GGA; PR.
- [ ] 9.5 BROWSER (Vercel preview, HTTPS, light+dark): login, lockout, inbox 1280/820/390, 44px, no horizontal scroll, "Volver" on phone.

## Final integration

- [ ] 10.1 Tracker `feat/in-app-feedback`: `npm test`, `tsc`, `lint` on root and `portal/`; `npm run test:portal-sync`; confirm portal-sync untouched; then merge to main and archive per SDD discipline.
- [ ] 10.2 End to end at LAN IP against the deployed portal: send offline → "Pendiente de envío" → reconnect → "Enviado"; one portal row; inbox shows delay flag.

## Owner manual steps (non-code)

1. Set `SUPPORT_PASSWORD` and `SUPPORT_SESSION_SECRET` in Vercel (portal project).
2. Apply portal migration 0002: `cd portal && npx drizzle-kit migrate`.
3. Deploy the portal via Vercel CLI from `portal/`. MUST happen BEFORE WU4 (workshop forwarding) runs in production; otherwise rows get 400 and retry at the 1 h cap.
4. Workshop: apply migration 0037 on the Windows host.
