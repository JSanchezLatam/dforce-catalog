# Tasks: crm-workshop-management

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2,760 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 Schema → PR2 Customers → PR3 Service-Orders → PR4 Reminders core → PR5 Routes+Forms → PR6 Pages+Nav → PR7 Provider wiring |
| Delivery strategy | ask-on-risk |
| Chain strategy | **feature-branch-chain** (confirmed by user 2026-07-26 — matches this project's convention on `adaptive-catalog-layouts`; gives rollback control on a schema-migration-heavy, multi-module change) |

Decision needed before apply: Resolved — 7 chained PRs, feature-branch-chain, confirmed by user 2026-07-26
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

3 new tables + a line-items table, 3 new modules (pure/queries/service each), pg-boss job + 2 external providers, 4 API routes, 4 pages, 2 client forms — ~35 files (27 new + 8 modified) cross 6 concerns. Single PR is not reviewable; splitting is mandatory, not optional here.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Schema + migration | PR 1 | ~200 lines, 2 files; base = feature/tracker branch |
| 2 | Customers module (validation+queries+service, TDD) | PR 2 | ~470 lines, 6 files; base = PR1 branch |
| 3 | Service-orders module (transitions+queries+service, TDD) | PR 3 | ~435 lines, 5 files; base = PR2 branch; depends on `cliente` (PR1) |
| 4 | Reminders core (schedule+job, TDD) + wiring edit into service-orders/service.ts | PR 4 | ~410 lines, 5 files; base = PR3 branch; depends on PR2+PR3 |
| 5 | API routes + client forms | PR 5 | ~540 lines, 6 files; base = PR4 branch |
| 6 | Pages + nav | PR 6 | ~455 lines, 5 files; base = PR5 branch |
| 7 | Provider wiring (Resend+Kapso real SDK calls, env, bootstrap, TDD) | PR 7 | ~250 lines, 6 files; base = PR6 branch; independently mergeable once templates approved (email path ships even if WhatsApp templates aren't yet — ADR-3) |

## ✅ Spec/Design Conflict — Resolved 2026-07-26

`specs/workshop-reminders/spec.md` R26's **two independent** per-channel
opt-out flags (`whatsapp_opt_out`, `email_opt_out`) was confirmed by the user
as correct. `design.md` §2.2/ADR-5 has been corrected to match (was a single
`remindersOptOut` boolean, deferring the per-channel split — now two columns,
checked independently per reminder's channel at fire time). Phase 1 below
implements the two-flag version; no remaining conflict.

`design.md` also gained **ADR-8**: `runReminder` must re-check the reminder
row's status before dispatching to a provider, so a pg-boss retry after a
partial failure (provider send succeeded, the DB write marking it `sent`
didn't) can't re-send a message the customer already received. Folded into
task 4.3 below (RED test should cover this no-op-on-already-sent case).

## Phase 1: Schema & Migration

- [x] 1.1 `shared/db/schema.ts` — add `boolean` to the `drizzle-orm/pg-core` import; add 4 `pgEnum`s (`order_status`, `reminder_type`, `reminder_channel`, `reminder_status`).
- [x] 1.2 `shared/db/schema.ts` — add `cliente` table: name/phone/email/vehicle fields + **`whatsappOptOut`/`emailOptOut`** booleans (R26, design ADR-5) + name/plate/createdAt indexes.
- [x] 1.3 `shared/db/schema.ts` — add `ordenServicio` table (clienteId FK restrict, status, description, appointmentAt, completedAt, createdBy FK) + (clienteId,createdAt)+status indexes.
- [x] 1.4 `shared/db/schema.ts` — add `ordenServicioItem` table (ordenId FK cascade, productoId FK set-null, productName+unitPrice snapshot, quantity) + ordenId index.
- [x] 1.5 `shared/db/schema.ts` — add `reminder` table (ordenId/clienteId FK cascade, type/channel/status, scheduledFor, sentAt, jobId, error) + indexes; export `$inferSelect` types for all 4 tables.
- [x] 1.6 Run `npx drizzle-kit generate` → verify `0005_legal_spot.sql` is additive-only (new enums+tables, zero diff to existing tables). **Note**: file is `0005_*`, not `0006_*` as design.md assumed — this branch's history does not yet include adaptive-catalog-layouts' migration (that change lives on a separate `feature/adaptive-layouts` branch not merged into this one), so `0004_stock_to_real.sql` was still the max on this branch. Purely a filename/numbering difference; content and additivity match design exactly.

## Phase 2: Customers Module

- [x] 2.1 RED `modules/customers/validation.test.ts` — required name/phone (R17), phone format regex, email format, vehicle-requires-plate rule, E.164 phone normalization.
- [x] 2.2 GREEN `modules/customers/validation.ts` — implement `validateClienteInput()` satisfying 2.1.
- [x] 2.3 RED `modules/customers/queries.test.ts` — list w/ pagination+name/phone/plate search (R19), get-by-id w/ service-order history join (R16), `findByPhone` for duplicate check (R18).
- [x] 2.4 GREEN `modules/customers/queries.ts` — implement against 2.3 with DI `deps` seam.
- [x] 2.5 RED `modules/customers/service.test.ts` — create rejects duplicate phone w/ link to existing (R18); edit persists only the changed field (R16); create/edit reject on validation errors.
- [x] 2.6 GREEN `modules/customers/service.ts` — implement `createCliente`/`updateCliente` calling validation.ts + queries.ts. **Note**: `cliente.phone` has NO DB-level unique constraint (Phase 1's schema/migration never added `.unique()` on that column) — duplicate detection (R18) is enforced entirely at the application layer via `findClienteByPhone`, not a DB constraint violation. Flagging since the apply prompt assumed a DB-level constraint existed; it does not, and adding one now is out of scope for this PR (would require a Phase 1 schema/migration change). App-layer enforcement is race-condition-prone under concurrent creates with the same phone — acceptable for v1 staff-only usage, but worth a follow-up ADR if concurrent double-booking becomes a real issue.

## Phase 3: Service-Orders Module

- [x] 3.1 RED `modules/service-orders/transitions.test.ts` — allowed/rejected transitions per R21 (all 7 scenarios); `done`/`cancelled` terminal.
- [x] 3.2 GREEN `modules/service-orders/transitions.ts` — `assertTransition()` + `OrderTransitionError`. `OrderStatus` derived from `orderStatusEnum.enumValues` (no separate type existed in schema.ts).
- [x] 3.3 RED `modules/service-orders/queries.test.ts` — list w/ status filter+pagination, get-by-id w/ line items, count.
- [x] 3.4 GREEN `modules/service-orders/queries.ts`.
- [x] 3.5 RED `modules/service-orders/service.test.ts` — create order+items in one tx (R20); duplicate-producto merge-or-append (pick one, test it); reject unknown `clienteId`; `-> done` sets `completedAt`; no `producto.stock` mutation (R22).
- [x] 3.6 GREEN `modules/service-orders/service.ts` — `createOrder`, `updateOrder`/`transitionOrder` (calls transitions.ts; reminder side-effects wired in Phase 4). **Note**: duplicate-`productoId` policy chosen = MERGE quantities (not append) — see service.ts's `normalizeOrderItems` doc comment for rationale. `transitionOrder` exposes an optional `onTransitioned` DI hook (no-op unless a caller supplies it) as the clean seam for Phase 4's reminder wiring — this PR does not import or call anything from a `reminders` module, which doesn't exist yet. `createOrder` validates `clienteId` via `customers/queries.ts`'s existing `getClienteById` (cross-module read, no new query duplicated); it does NOT validate `productoId` against the `producto` table (out of this task's explicit scope — only "reject unknown `clienteId`" was required).

## Phase 4: Reminders Module

- [x] 4.1 RED `modules/reminders/schedule.test.ts` — `planReminders()`: appointment = `appointmentAt - 24h`, service_due = `completedAt + 90d`; skips a channel with no contact info or opted-out (R26); drops past-due timestamps (R23).
- [x] 4.2 GREEN `modules/reminders/schedule.ts` — implement per 4.1 + module constants.
- [x] 4.3 RED `modules/reminders/job.test.ts` (DI fake boss+providers) — `scheduleReminder` calls `sendAfter` with a concrete Date and persists `jobId`; `runReminder` re-checks per-channel opt-out/cancelled/stale at fire time (R23, R26) before dispatch; `runReminder` on a row whose status is already `sent` is a no-op — doesn't call the provider again (ADR-8, retry-safety); `cancelReminder` flips row + removes the job.
- [x] 4.4 GREEN `modules/reminders/job.ts` — `ensureQueue`/`scheduleReminder`/`runReminder`/`cancelReminder`/`registerReminderWorker`; `localConcurrency` (not `teamSize`); `retryLimit:3`+backoff+DLQ (R24, R25). **Note**: `runReminder`'s R26 opt-out outcome uses the existing `skipped` status (design.md ADR-5's literal wording), not a separate `opted_out` enum value — `reminderStatusEnum` (frozen since Phase 1) has no `opted_out` member. This deviates from spec R26's literal wording ("record the outcome as `opted_out`"); flagged as an unresolved spec/design nuance for a follow-up (would need a Phase-1-touching migration, out of Phase 4's scope).
- [x] 4.5 Edit `modules/service-orders/service.ts` — on `-> done` call `planReminders`+`scheduleReminder` (service_due); on appointment set/change (in `updateOrder`), cancel+reschedule the appointment reminder; on `-> cancelled` call `cancelRemindersForOrder` for all pending rows (R23). Also wired into `createOrder` (an order created with `appointmentAt` set schedules its appointment reminder immediately — required by R23's "staff set an explicit future appointment date" scenario, not just the transition path). **Architecture call**: wired as a DIRECT import from `service-orders/service.ts` into `reminders/{schedule,job}.ts` (not via an external composition point) — design.md §6/§9 and this task's own wording ("Edit modules/service-orders/service.ts") are explicit that the side effect lives here. Dependency direction stays one-way (service-orders → reminders; reminders never imports service-orders), so no cycle. The Phase 3 `onTransitioned` DI hook is kept as a separate, still-available extension seam but is NOT the mechanism used for this wiring.
- [x] 4.6 Extended `modules/service-orders/service.test.ts` with a "reminder wiring (R23, Phase 4 task 4.5)" describe block — asserts reminder rows/jobs created/cancelled per 4.5 via injected fakes (`scheduleReminder`/`cancelRemindersForOrder`/`getClienteById` all overridable).

## Phase 5: API Routes & Forms

- [ ] 5.1 `app/api/customers/route.ts` — `POST`, `requireSession`+DI handle split (mirrors manual-sync route), calls `customers/service.ts`.
- [ ] 5.2 `app/api/customers/[id]/route.ts` — `PATCH` edit / opt-out toggle.
- [ ] 5.3 `app/api/service-orders/route.ts` — `POST` create order+items.
- [ ] 5.4 `app/api/service-orders/[id]/route.ts` — `PATCH` field update / status transition.
- [ ] 5.5 `modules/customers/CustomerForm.tsx` — client form (Dialog+Input+Label+Button, `FIELD_ERROR` pattern), both opt-out Checkboxes, POST/PATCH to 5.1/5.2.
- [ ] 5.6 `modules/service-orders/ServiceOrderForm.tsx` — customer select, parts picker (reuse builder search/Table idiom), appointment date, submit to 5.3/5.4.

## Phase 6: Pages & Navigation

- [ ] 6.1 `app/(app)/customers/page.tsx` — server component, `searchParams`, `Promise.all([listCustomers,countCustomers])`, name/phone/plate filter card, `Pagination`, empty-state (R16, R19).
- [ ] 6.2 `app/(app)/customers/[id]/page.tsx` — customer info Card + service-history Table, empty-state when zero orders (R16).
- [ ] 6.3 `app/(app)/service-orders/page.tsx` — list + status-filter Select + Pagination (R21).
- [ ] 6.4 `app/(app)/service-orders/[id]/page.tsx` — order header, line-items table, status-transition controls, scheduled/sent reminders list (R24, R25).
- [ ] 6.5 `components/app-sidebar.tsx` (edit) — add "Clientes"/"Órdenes de servicio" nav entries.

## Phase 7: Provider Wiring

- [ ] 7.1 `shared/config/env.ts` (edit) — add `RESEND_API_KEY`/`RESEND_FROM`/`KAPSO_API_KEY`/`KAPSO_PHONE_NUMBER_ID`/2 template env vars (all `optional`); add both API keys to `SENSITIVE_ENV_KEYS`.
- [ ] 7.2 RED `modules/reminders/providers/email.test.ts` — sends via Resend SDK with `from`/`to`/`subject`/`html`; no-ops gracefully (marks reminder `failed`/`skipped` with reason) when `RESEND_API_KEY` is absent.
- [ ] 7.3 GREEN `modules/reminders/providers/email.ts` — implement with `resend` npm SDK (ADR-4); add `resend` dependency.
- [ ] 7.4 RED `modules/reminders/providers/whatsapp.test.ts` — sends via Kapso **template** (not `sendText`, ADR-3); graceful no-op when Kapso env is missing.
- [ ] 7.5 GREEN `modules/reminders/providers/whatsapp.ts` — implement with `@kapso/whatsapp-cloud-api` `WhatsAppClient`, named-param template send.
- [ ] 7.6 `instrumentation-node.ts` (edit) — add `registerReminderWorker()` to `registerNodeWorkers()`.

## Key estimates

| Phase | Lines | Files |
|-------|-------|-------|
| Schema & Migration | ~200 | 2 |
| Customers Module | ~470 | 6 |
| Service-Orders Module | ~435 | 5 |
| Reminders Module | ~410 | 5 |
| API Routes & Forms | ~540 | 6 |
| Pages & Navigation | ~455 | 5 |
| Provider Wiring | ~250 | 6 |
| **Total** | **~2,760** | **~35** (27 new + 8 modified) |
