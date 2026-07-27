# Tasks: crm-workshop-management

## ⚠ Migration renumbering at merge time (2026-07-27)

When merging this change's tracker into `main`, both `adaptive-catalog-layouts`
(merged first) and this change had independently generated a migration numbered
`0005` — each branch started from a point before the other existed. Resolved
by deleting this change's `0005_legal_spot.sql` and the follow-up
`0006_add_opted_out_reminder_status.sql` (neither was ever applied to any real
database — both were still on unmerged feature branches) and regenerating a
single fresh migration, `0006_shiny_dazzler.sql`, from `main`'s actual settled
state. It collapses the original schema migration and the `opted_out` fix into
one: `reminder_status` is created with `opted_out` already in its value list
from the start, rather than added via a later `ALTER TYPE`. Functionally
identical end state; the two-step history described below (tasks 1.6 and the
Phase 4 follow-up note) is preserved for narrative accuracy but the actual
merged migration file numbers/names differ from what's described there.

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
- [x] 4.4 GREEN `modules/reminders/job.ts` — `ensureQueue`/`scheduleReminder`/`runReminder`/`cancelReminder`/`registerReminderWorker`; `localConcurrency` (not `teamSize`); `retryLimit:3`+backoff+DLQ (R24, R25). **Note (superseded — see follow-up fix below)**: originally `runReminder`'s R26 opt-out outcome used the existing `skipped` status (design.md ADR-5's literal wording at the time), not a separate `opted_out` enum value, because `reminderStatusEnum` (frozen since Phase 1) had no `opted_out` member. This deviated from spec R26's literal wording ("record the outcome as `opted_out`") and was flagged as an unresolved spec/design nuance for a follow-up.
- [x] 4.5 Edit `modules/service-orders/service.ts` — on `-> done` call `planReminders`+`scheduleReminder` (service_due); on appointment set/change (in `updateOrder`), cancel+reschedule the appointment reminder; on `-> cancelled` call `cancelRemindersForOrder` for all pending rows (R23). Also wired into `createOrder` (an order created with `appointmentAt` set schedules its appointment reminder immediately — required by R23's "staff set an explicit future appointment date" scenario, not just the transition path). **Architecture call**: wired as a DIRECT import from `service-orders/service.ts` into `reminders/{schedule,job}.ts` (not via an external composition point) — design.md §6/§9 and this task's own wording ("Edit modules/service-orders/service.ts") are explicit that the side effect lives here. Dependency direction stays one-way (service-orders → reminders; reminders never imports service-orders), so no cycle. The Phase 3 `onTransitioned` DI hook is kept as a separate, still-available extension seam but is NOT the mechanism used for this wiring.
- [x] 4.6 Extended `modules/service-orders/service.test.ts` with a "reminder wiring (R23, Phase 4 task 4.5)" describe block — asserts reminder rows/jobs created/cancelled per 4.5 via injected fakes (`scheduleReminder`/`cancelRemindersForOrder`/`getClienteById` all overridable).

**Follow-up fix (post-Phase-4, same branch `crm-workshop/pr4-reminders-core`, new commit on top of 1b94da3)**: closed the R26 spec/schema gap flagged in task 4.4's note above. Added `"opted_out"` to `reminderStatusEnum` in `src/shared/db/schema.ts` via a new additive migration `src/shared/db/migrations/0006_add_opted_out_reminder_status.sql` (`ALTER TYPE "public"."reminder_status" ADD VALUE 'opted_out'` — generated by `npx drizzle-kit generate`, pure additive, no table rebuild; does NOT edit `0005_legal_spot.sql` in place). `runReminder` in `modules/reminders/job.ts` now records `status: "opted_out"` (via a new `markOptedOut()` helper) specifically for the per-channel opt-out branch, while the cancelled-order and stale-appointment-timing branches still correctly use `markSkipped()`/`status: "skipped"`. Updated the two opt-out assertions in `modules/reminders/job.test.ts` to expect `'opted_out'` (RED confirmed failing against the old `skipped` behavior, then GREEN after the schema+job.ts change); the cancelled/stale skip-reason tests were left unchanged and still pass. Also updated `design.md`'s ADR-5 prose, ADR index (row 5), the §9 data-flow diagram, and the §2.1 enum snippet to explicitly describe `opted_out` as distinct from `skipped`. `specs/workshop-reminders/spec.md` R26 already used the correct `opted_out` wording — no spec change needed. `npx tsc --noEmit` and the full `npx vitest run` suite (255 tests / 28 files baseline, unchanged count — 2 tests modified not added) pass clean.

## Phase 5: API Routes & Forms

- [x] 5.1 `app/api/customers/route.ts` — `POST`, `requireSession`+DI handle split (mirrors manual-sync route), calls `customers/service.ts`.
- [x] 5.2 `app/api/customers/[id]/route.ts` — `PATCH` edit / opt-out toggle.
- [x] 5.3 `app/api/service-orders/route.ts` — `POST` create order+items.
- [x] 5.4 `app/api/service-orders/[id]/route.ts` — `PATCH` field update / status transition.
- [x] 5.5 `modules/customers/CustomerForm.tsx` — client form (Dialog+Input+Label+Button, `FIELD_ERROR` pattern), both opt-out Checkboxes, POST/PATCH to 5.1/5.2.
- [x] 5.6 `modules/service-orders/ServiceOrderForm.tsx` — customer select, parts picker (reuse builder search/Table idiom), appointment date, submit to 5.3/5.4.

**Notes (Phase 5, branch `crm-workshop/pr5-routes-forms`)**: design.md §7 explicitly specifies API Route Handlers (not Server Actions) for these four routes — used routes to match, despite this same session's earlier, unrelated migration of `/login` to a Server Action (that precedent was not extended here since design.md's plan is explicit). All four routes follow `manual/route.ts`'s exact `requireSession()` → `handleX(request, ..., deps)` → thin exported `POST`/`PATCH` split, with no `can()` gate (design.md §7: "do NOT add new `policy.ts` actions for v1"). `service-orders/[id]/route.ts`'s single `PATCH` branches on `typeof body.status === "string"` to either call `transitionOrder` (R21, also carries R23's reminder scheduling/cancellation) or `updateOrder` (plain `description`/`appointmentAt` edit) — one route serving both per the route table's "field update / status transition" wording. Client forms have no test files, matching this repo's existing convention (`CatalogBuilderForm.tsx`/`TemplateConfigForm.tsx` are untested; no `@testing-library` dependency exists). `ServiceOrderForm.tsx`'s parts picker reuses `CatalogBuilderForm.tsx`'s client-side search+Table idiom over an already-fetched `products` list (no new search route) since `updateOrder`'s patch type only supports `description`/`appointmentAt` — customer/parts are immutable post-creation, so edit mode of the form hides the customer-select and parts sections. `npx tsc --noEmit` clean; full `npx vitest run`: 273/273 tests passing, 32/32 files (was 255/28 after Phase 4 + opted_out fix; +18 tests / +4 files, all new route tests — no existing test modified).

## Phase 6: Pages & Navigation

- [x] 6.1 `app/(app)/customers/page.tsx` — server component, `searchParams`, `Promise.all([listCustomers,countCustomers])`, name/phone/plate filter card, `Pagination`, empty-state (R16, R19).
- [x] 6.2 `app/(app)/customers/[id]/page.tsx` — customer info Card + service-history Table, empty-state when zero orders (R16).
- [x] 6.3 `app/(app)/service-orders/page.tsx` — list + status-filter Select + Pagination (R21).
- [x] 6.4 `app/(app)/service-orders/[id]/page.tsx` — order header, line-items table, status-transition controls, scheduled/sent reminders list (R24, R25).
- [x] 6.5 `components/app-sidebar.tsx` (edit) — add "Clientes"/"Órdenes de servicio" nav entries.

**Notes (Phase 6, branch `crm-workshop/pr6-pages-nav`)**: Nav items are NOT
defined directly in `app-sidebar.tsx` — `src/modules/layout/nav-items.ts`'s
`getNavItems()` is the actual source of truth (confirmed via
`nav-items.test.ts` before editing); `app-sidebar.tsx` only holds the
`ICON_MAP` lookup from icon-key string to a lucide-react component (RSC
boundary: a Server Component can't hand a function/component reference to a
Client Component). Added `"Clientes"` (`/customers`, icon `Users`) and
`"Órdenes de servicio"` (`/service-orders`, icon `Wrench`) to
`BASE_NAV_ITEMS` — both staff-only via the blanket `requireSession` guard,
same as the 3 existing base items, per design.md §7's explicit "no new
`customers.manage`/`orders.manage` policy action for v1" — NOT gated by
`can()`, so they always render regardless of role (unlike
"Configuración de Template", which stays admin-gated). `nav-items.test.ts`
updated to expect 5/6 items instead of 3/4.

3 small grounded deviations from the literal task wording, all pure/tested
additions rather than freelanced UI:
1. **Customer filter is ONE search field, not three.** `customers/queries.ts`'s
   `buildClienteSearchWhere` (Phase 2) already ORs a single search term across
   name/phone/plate (R19's literal wording: "a partial, case-insensitive match
   against name, phone, or vehicle plate") — there is no separate per-field
   filter in the query layer, so three independent inputs would misrepresent
   how the page actually filters. `CustomerFilters.tsx` renders one combined
   search box instead.
2. **New `getAllowedTransitions()` in `transitions.ts`** (RED/GREEN,
   `transitions.test.ts`) — the order-detail page's status-transition buttons
   need to know which next-states are legal for a given order without
   duplicating `ALLOWED_TRANSITIONS`' table on the UI side; this pure getter
   is the seam, covered by 3 new tests.
3. **New `reminders/queries.ts`** (RED/GREEN, `queries.test.ts`) — Phase 4 had
   no "list all reminders for an order" read function (only
   `cancelRemindersForOrder`'s internal, status-filtered select). Added
   `listRemindersForOrder(ordenId, queryFn)`, DI-testable via the same
   injected-`queryFn` convention as `customers/queries.ts`/
   `service-orders/queries.ts`, for the order-detail page's reminders list.

`StatusBadge.tsx`'s `BadgeStatus` union + its 3 lookup `Record`s were extended
(RED/GREEN, `StatusBadge.test.ts`) to cover `order_status`
(open/in_progress/done/cancelled) and `reminder_status`
(scheduled/sent/skipped/opted_out) — design.md §8 explicitly says to reuse
`StatusBadge` for "order + reminder status pills", so this is additive
coverage of an already-tested shared component, not a new one.

Server pages cannot pass plain functions as props to Client Components across
the RSC boundary, so `CustomerForm`/`ServiceOrderForm`'s `onSaved` callback
(Phase 5) needed a small client-side composition seam:
`CustomerFormTrigger.tsx`/`ServiceOrderFormTrigger.tsx` each own `useRouter()`
internally and supply `onSaved={() => router.refresh()}` themselves, so the
server-rendered list/detail data refreshes after a successful create/edit
without a full page reload. `OrderStatusControls.tsx` (client) follows the
same shape for the order-detail page's status-transition buttons, PATCHing
`/api/service-orders/[id]` with `{ status }` (Phase 5's route) then calling
`router.refresh()`.

`ServiceOrderForm`'s customer-select and parts-picker (Phase 5) need an
already-fetched list — `service-orders/page.tsx` fetches both
`listClientes({}, {offset:0, limit:1000})` and
`listInventory({}, {offset:0, limit:1000})` up front. Known limitation
(flagged, not fixed here): a 1000-row cap with no dedicated search route for
either list — acceptable for v1 shop-scale data, same tradeoff Phase 5's notes
already accepted for the parts picker.

`npx tsc --noEmit` clean; full `npx vitest run`: **280/280 tests passing,
33/33 files** (was 273/32 after Phase 5 — +7 tests/+1 file: 3 new
`getAllowedTransitions` tests, 2 new `listRemindersForOrder` tests in a new
file, 2 new `StatusBadge` mapping tests; `nav-items.test.ts`'s existing 3
tests were edited in place, not added to). `npx eslint` on every new/touched
Phase 6 file: 0 errors, 0 warnings — the 14 pre-existing problems (4 errors/10
warnings) from a full `npx eslint src` run are all in files this phase never
touched (`CatalogBuilderForm.tsx`, `TreeSelect.tsx`, `InventoryFilters.tsx`,
`reminders/job.test.ts`, `service-orders/service.test.ts`,
`TemplateConfigForm.tsx`, `CatalogTemplate.tsx`, `LazyImage.tsx`).

## Phase 7: Provider Wiring

- [x] 7.1 `shared/config/env.ts` (edit) — add `RESEND_API_KEY`/`RESEND_FROM`/`KAPSO_API_KEY`/`KAPSO_PHONE_NUMBER_ID`/2 template env vars (all `optional`); add both API keys to `SENSITIVE_ENV_KEYS`.
- [x] 7.2 RED `modules/reminders/providers/email.test.ts` — sends via Resend SDK with `from`/`to`/`subject`/`html`; no-ops gracefully (marks reminder `failed`/`skipped` with reason) when `RESEND_API_KEY` is absent.
- [x] 7.3 GREEN `modules/reminders/providers/email.ts` — implement with `resend` npm SDK (ADR-4); add `resend` dependency.
- [x] 7.4 RED `modules/reminders/providers/whatsapp.test.ts` — sends via Kapso **template** (not `sendText`, ADR-3); graceful no-op when Kapso env is missing.
- [x] 7.5 GREEN `modules/reminders/providers/whatsapp.ts` — implement with `@kapso/whatsapp-cloud-api` `WhatsAppClient`, named-param template send.
- [x] 7.6 `instrumentation-node.ts` (edit) — add `registerReminderWorker()` to `registerNodeWorkers()`.

**Notes (Phase 7, branch `crm-workshop/pr7-providers`, base = `crm-workshop/pr6-pages-nav` @ `18c3bce`) — LAST phase, 41/41 tasks now complete:**

Both SDKs were installed from npm (`resend@6.18.0`, `@kapso/whatsapp-cloud-api@0.2.3`)
and their **shipped `.d.ts`/`.d.cts` type declarations were read directly**
(not guessed) before writing any code:
- `resend`: `Emails.send(payload): Promise<Response<CreateEmailResponseSuccess>>`
  where `Response<T> = ({ data: T; error: null } | { data: null; error:
  ErrorResponse }) & { headers }` — the SDK does **not** throw for API-level
  errors (invalid `from`, quota, etc.), it returns `{ error }`; only network-
  level failures would throw. `providers/email.ts` handles both: reads
  `error.message` when present, and (implicitly, since nothing catches it) a
  thrown network error would propagate up through `sendEmail` unhandled —
  acceptable since job.ts's `runReminder` already wraps the whole
  `sendViaChannel` dispatch call in try/catch and marks `failed`+rethrows
  either way (R25).
- `@kapso/whatsapp-cloud-api`: `messages.sendTemplate({ phoneNumberId, to,
  template: { name, language: { code }, components } })` **matched the
  `integrate-whatsapp` skill's documented example exactly** — no adaptation
  needed. One thing the skill's prose doesn't spell out but the type
  declarations confirmed: `GraphApiError extends Error` — the SDK **throws**
  on a real send failure (unlike Resend's `{ error }` return), so
  `providers/whatsapp.ts` wraps the `sendTemplate` call in try/catch and
  converts it to the same `{ ok: false, reason }` shape `providers/email.ts`
  returns, so `reminders/job.ts`'s dispatch wiring can treat both providers
  uniformly regardless of which failure convention each SDK uses natively.

**Provider DI design (deviation from the "inject an env-shaped config" idea
implied by the apply prompt):** rather than mocking `@/shared/config/env`
(the module's `env` object is built once from `process.env` at first import —
fragile to fake per-test, and no precedent for `vi.mock`-ing it exists in this
repo), both `sendEmail`/`sendWhatsAppTemplate` accept optional `deps.apiKey`/
`deps.from`/`deps.phoneNumberId` overrides that take precedence over
`env.*` when provided (even `""`, which deliberately forces the
not-configured path deterministically in a test regardless of the ambient
shell's real env). This mirrors this codebase's established `deps`-seam
convention (`job.ts`, `customers/queries.ts`) rather than introducing a new
env-mocking pattern. Same reasoning extended to `runReminder`'s new
`deps.kapsoTemplates` override (for the `appointment`/`service_due` template
name, otherwise read from `env.KAPSO_TEMPLATE_APPOINTMENT`/
`KAPSO_TEMPLATE_SERVICE_DUE`) — needed because `env.ts`'s module-singleton
values are captured at first import, before any in-test `process.env`
mutation could take effect.

**Wiring `runReminder`'s `sendViaChannel` seam:** `job.ts`'s Phase-4 stand-in
(`defaultSendViaChannel`, which unconditionally threw `"no provider wired for
this channel yet (Phase 7)"`) is replaced by `buildDefaultSendViaChannel(
kapsoTemplates?)`, used as `deps.sendViaChannel ?? buildDefaultSendViaChannel(
deps.kapsoTemplates)` — the DI seam itself (`RunReminderDeps.sendViaChannel`)
is unchanged and still fully overridable by tests (all of Phase 4's existing
`job.test.ts` assertions keep injecting a fake `sendViaChannel` and pass
unmodified). The new default routes by `ctx.reminder.channel`: `email` builds
a `{ to: cliente.email, subject, html }` from the reminder `type` and calls
`providers/email.ts`; `whatsapp` picks the type-specific template name and
calls `providers/whatsapp.ts` with a single NAMED body param
(`customer_name`). Either provider's `{ ok: false, reason }` is converted to
a thrown `Error` here — that throw is what makes `runReminder`'s existing
catch-and-rethrow-for-pg-boss-retry logic (R25, unchanged since Phase 4) also
cover "provider not configured" and "no Kapso template configured for this
reminder's type" as just another failure mode landing in the DLQ after
`retryLimit` attempts, with no new failure-handling branch needed in
`runReminder` itself.

**E.164 phone format** — confirmed, not re-implemented: `customers/
validation.ts`'s `normalizePhone()` (Phase 2) already strips separators and
preserves a leading `+` on write, so `cliente.phone` read by `job.ts` is
already in the shape Kapso's `to` field expects. `providers/whatsapp.ts`'s
own header comment states this explicitly as a cross-reference rather than
silently assuming it.

**`instrumentation-node.ts``** — confirmed via reading the file that Phase 4
did NOT register the reminder worker (its own header comment said "Starts
all **three** pg-boss workers eagerly at boot" and `registerNodeWorkers()`
only imported/called `registerInventorySyncWorker`, `scheduleWeeklySync`,
`registerPdfGenerateWorker`, `registerPdfUploadWorker` — reminders were
missing). Added a 4th dynamic import + call for `registerReminderWorker` from
`@/modules/reminders/job`, matching the existing dynamic-import style (kept
for consistency, not because reminders/job.ts has pdf-generation's
build-graph problem). No `schedule()`/cron call added for reminders — matches
design.md §5's explicit note that reminders are enqueued on demand by
`service-orders/service.ts`, not on a recurring schedule. No test file exists
for `instrumentation-node.ts` (no prior test existed for it either — pure
bootstrap wiring, same untested-file convention as `catalog-storage/r2.ts`).

**Verification**: `npx tsc --noEmit` clean (zero errors). Full `npx vitest
run`: **294/294 tests passing, 35/35 files** (was 280/33 after Phase 6 —
+14 tests/+2 files: 4 new `providers/email.test.ts`, 4 new
`providers/whatsapp.test.ts`, +6 new tests appended to the existing
`job.test.ts` for the real-dispatch wiring — routes to the right provider by
channel, uses the type-specific Kapso template, and marks `failed`+rethrows
on any provider/config failure). `npx eslint` on every new/touched Phase 7
file: 0 errors; 1 pre-existing warning in `job.test.ts` (`'table' is defined
but never used` in the Phase-4 `makeFakeDb` helper, confirmed unmodified by
this phase via `git show HEAD:...`) — zero new lint issues introduced.

**Where**: `src/shared/config/env.ts` (edit), `src/modules/reminders/job.ts`
(edit), `src/modules/reminders/job.test.ts` (edit, +6 tests),
`src/modules/reminders/providers/email.ts` + `email.test.ts` (new),
`src/modules/reminders/providers/whatsapp.ts` + `whatsapp.test.ts` (new),
`src/instrumentation-node.ts` (edit), `package.json`/`package-lock.json`
(added `resend`, `@kapso/whatsapp-cloud-api` dependencies).

### Status — ALL 7 PHASES COMPLETE (41/41 tasks)
This closes out `crm-workshop-management`. 7 chained PR-slice branches exist,
none pushed/merged, all local on top of tracker `feature/crm-workshop-management`
(feature-branch-chain): `crm-workshop/pr1-schema` → `pr2-customers` →
`pr3-service-orders` → `pr4-reminders-core` → `pr5-routes-forms` →
`pr6-pages-nav` → `pr7-providers` (this phase, HEAD). Ready for review/
`sdd-verify` across the chain, then sequential merge per `feature-branch-chain`
strategy.

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
