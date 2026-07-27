# Design: crm-workshop-management

> Technical design (the HOW at architectural level). Grounded in the real
> codebase, not assumptions — every convention below is copied from an existing
> module and cited. Tasks (the concrete WHAT-to-do steps) come in the next phase.

## 1. Architecture Approach

Additive, native Postgres/Drizzle feature built with the **exact module
conventions already in the repo** — no new patterns invented. Three new
capability modules mirror the established `inventory-view` / `catalog-builder` /
`inventory-sync` layout:

| Layer | Existing template | New modules follow it |
|-------|-------------------|-----------------------|
| Pure logic (DB-free, unit-tested first) | `catalog-builder/selection.ts`, `inventory-view/queries.ts` `normalizeFilters`/`computePageWindow` | `customers/validation.ts`, `service-orders/transitions.ts`, `reminders/schedule.ts` |
| DB read model | `inventory-view/queries.ts` | `customers/queries.ts`, `service-orders/queries.ts` |
| DB writes + validation orchestration | `template-config/service.ts` | `customers/service.ts`, `service-orders/service.ts` |
| pg-boss job (queue + worker) | `inventory-sync/job.ts` | `reminders/job.ts` |
| Server-component page (read) | `app/(app)/inventory/page.tsx` | `app/(app)/customers`, `app/(app)/service-orders` |
| API route (mutation, `requireSession`+DI) | `app/api/inventory-sync/manual/route.ts` | `api/customers`, `api/service-orders` |
| Client form | `catalog-builder/CatalogBuilderForm.tsx` | `customers/CustomerForm.tsx`, `service-orders/ServiceOrderForm.tsx` |

**Layering rule (enforced by the repo, kept here):** pure functions carry ALL
validation and business rules (status-transition legality, reminder timing,
customer-field validation) so they are unit-testable without Postgres — exactly
as `selection.ts`'s header states. `queries.ts`/`service.ts` touch the DB;
routes are thin auth+DI shells.

## 2. Data Model (exact Drizzle schema, matching `schema.ts` conventions)

Conventions copied verbatim from existing tables: `text` PK defaulted with
`crypto.randomUUID()` (`users`, `syncRuns`, `catalogs`); `timestamp(col,
{ withTimezone: true }).notNull().defaultNow()`; `pgEnum` for status columns
(`roleEnum`, `syncStatusEnum`, `uploadStatusEnum`); FK via
`references(() => x.id, { onDelete })`; indexes in the second table-callback
returning an array; `type X = typeof x.$inferSelect` exports.

New import needed in `schema.ts`: add `boolean` to the existing
`drizzle-orm/pg-core` import line.

### 2.1 Enums

```ts
export const orderStatusEnum   = pgEnum("order_status",   ["open", "in_progress", "done", "cancelled"]);
export const reminderTypeEnum  = pgEnum("reminder_type",  ["service_due", "appointment"]);
export const reminderChannelEnum = pgEnum("reminder_channel", ["email", "whatsapp"]);
export const reminderStatusEnum  = pgEnum("reminder_status",  ["scheduled", "sent", "failed", "cancelled", "skipped", "opted_out"]);
// `opted_out` was added post-Phase-4 (migration 0006, additive ALTER TYPE ...
// ADD VALUE) once the R26 spec/schema gap flagged during Phase 4 apply was
// triaged and fixed — see ADR-5.
```

### 2.2 `cliente` — customer + inline single vehicle (v1)

```ts
export const cliente = pgTable("cliente", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  phone: text("phone"),                 // E.164 preferred (WhatsApp needs it); validated in validation.ts
  email: text("email"),
  vehicleMake: text("vehicle_make"),
  vehicleModel: text("vehicle_model"),
  vehicleYear: integer("vehicle_year"),
  vehiclePlate: text("vehicle_plate"),
  // Opt-out re-checked at reminder fire time (see ADR-5). Two independent
  // flags per spec R26 — WhatsApp and email are legally distinct consent
  // regimes (Meta Business messaging policy vs. email marketing law), so a
  // customer can decline one channel without losing the other.
  whatsappOptOut: boolean("whatsapp_opt_out").notNull().default(false),
  emailOptOut: boolean("email_opt_out").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("cliente_name_idx").on(table.name),          // list search by name
  index("cliente_plate_idx").on(table.vehiclePlate), // lookup by plate
  index("cliente_created_idx").on(table.createdAt),  // newest-first listing
]);
export type Cliente = typeof cliente.$inferSelect;
```

### 2.3 `orden_servicio` — service order

```ts
export const ordenServicio = pgTable("orden_servicio", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  clienteId: text("cliente_id").notNull()
    .references(() => cliente.id, { onDelete: "restrict" }), // protect history (ADR-6)
  status: orderStatusEnum("status").notNull().default("open"),
  description: text("description"),
  appointmentAt: timestamp("appointment_at", { withTimezone: true }), // basis for "appointment" reminders
  completedAt: timestamp("completed_at", { withTimezone: true }),     // set on -> done; basis for "service_due"
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("orden_cliente_created_idx").on(table.clienteId, table.createdAt), // per-customer history (mirrors catalogs_user_created_idx)
  index("orden_status_idx").on(table.status),
]);
export type OrdenServicio = typeof ordenServicio.$inferSelect;
```

### 2.4 `orden_servicio_item` — parts used (line items, ADR-7)

```ts
export const ordenServicioItem = pgTable("orden_servicio_item", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  ordenId: text("orden_id").notNull()
    .references(() => ordenServicio.id, { onDelete: "cascade" }),   // items die with the order
  productoId: text("producto_id")
    .references(() => producto.id, { onDelete: "set null" }),       // soft ref — re-sync must not delete history
  productName: text("product_name").notNull(),  // snapshot at time of use (durable, survives rename/re-sync)
  unitPrice: real("unit_price"),                 // snapshot; `real` per producto.price convention
  quantity: integer("quantity").notNull().default(1),
}, (table) => [
  index("orden_item_orden_idx").on(table.ordenId),
]);
export type OrdenServicioItem = typeof ordenServicioItem.$inferSelect;
```

Snapshot rationale is the same philosophy as `catalogs.categories` (denormalized
snapshot of selection at generation time) and `producto.raw` (write-once record):
a later inventory sync that renames/reprices a part must NOT rewrite a historical
order. No stock deduction (explicitly out of scope in the proposal).

### 2.5 `reminder` — source of truth for scheduled reminders (ADR-2)

```ts
export const reminder = pgTable("reminder", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  ordenId: text("orden_id").notNull().references(() => ordenServicio.id, { onDelete: "cascade" }),
  clienteId: text("cliente_id").notNull().references(() => cliente.id, { onDelete: "cascade" }),
  type: reminderTypeEnum("type").notNull(),
  channel: reminderChannelEnum("channel").notNull(),
  status: reminderStatusEnum("status").notNull().default("scheduled"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  jobId: text("job_id"),   // pg-boss job id returned by sendAfter() — for correlation + cancellation
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("reminder_orden_idx").on(table.ordenId),
  index("reminder_status_sched_idx").on(table.status, table.scheduledFor),
]);
export type Reminder = typeof reminder.$inferSelect;
```

### 2.6 Migration

`npx drizzle-kit generate` produces the next file `0006_*.sql` in
`src/shared/db/migrations/` (current max is `0005_naive_mentallo.sql`). All
additive — new enums + 4 tables, zero changes to existing tables — so the
rollback is a plain drop (proposal's rollback plan holds). Generate in one pass;
drizzle-kit orders enum creation before the tables that use them.

## 3. Reminder Scheduling — the flagged technical risk, resolved

The proposal flagged: *"pg-boss scheduled-send semantics differ from
expectation — validate `sendAfter` in design phase."* **Validated against the
installed version.**

- Installed: **pg-boss 12.26.2** (`node_modules/pg-boss/package.json`).
- `node_modules/pg-boss/dist/index.d.ts` line 20-22 confirms:
  `sendAfter(name, data, options, date | dateString | seconds): Promise<string|null>`.
- `schedule(name, cron, data, options)` (line 81) is a **recurring cron** — this
  is what `inventory-sync/job.ts` uses for the weekly sync (`WEEKLY_CRON`).
- `SendOptions` (`dist/types.d.ts`) exposes `retryLimit`, `retryDelay`,
  `retryBackoff`, `retryDelayMax`, `deadLetter`, `singletonKey`,
  `expireInSeconds`, `startAfter`.

### ADR-1 — Use `sendAfter(date)`, NOT `schedule(cron)`, for per-order reminders

**Decision:** each reminder is a **one-shot job** enqueued via
`boss.sendAfter(REMINDER_SEND_JOB, { reminderId }, opts, reminder.scheduledFor)`.

**Why:** cron `schedule()` fires repeatedly on a fixed calendar expression. A
reminder is "fire once, at THIS order's unique appointment/completion-derived
instant" — not a recurring calendar event. `sendAfter` with a concrete `Date`
enqueues a single job that becomes eligible at exactly that timestamp. This is
the correct primitive and it exists in the pinned version.

**Rejected:** (a) `schedule()` cron per order — wrong semantics (recurring, and
you'd need to unschedule after first fire); (b) one global cron that polls the
`reminder` table every minute for due rows — more moving parts, worse latency,
and duplicates what pg-boss already does natively with `sendAfter`. We keep the
`reminder` table as truth (ADR-2) but let pg-boss own the timing.

### ADR-2 — `reminder` table is source of truth; pg-boss job is transport

**Decision:** persist every reminder as a `reminder` row; the `sendAfter` job
payload carries only `{ reminderId }`. The worker loads the row at fire time.

**Why:** identical to the established Risk-6 pattern in `inventory-sync/job.ts`
(`sync_runs` is truth, not pg-boss internals — see `hasActiveSyncRun`). pg-boss
job rows get archived/pruned and are opaque; we need queryable, auditable
reminder state (`scheduled → sent | failed | cancelled | skipped`), the ability
to **cancel** when an order is cancelled/rescheduled (`boss.unschedule` is for
crons; for `sendAfter` jobs we store `jobId` and cancel via pg-boss job
deletion + flip the row to `cancelled`), and history for the customer detail
view. "DB row is truth, queue is transport" is already this codebase's rule.

### ADR-5 — Opt-out and order-state re-check happen at FIRE time, in the worker

**Decision:** `runReminder(reminderId)` reloads `reminder` + its `orden_servicio`
+ `cliente`, and checks the channel-specific flag for the reminder's own
`channel` (`cliente.whatsappOptOut` for a WhatsApp reminder, `cliente.emailOptOut`
for an email one) — records the status as `opted_out` (R26 — distinct from the
generic `skipped` used for the order-cancelled/stale-timing cases below) if
that channel's flag is true; marks `skipped` if the order is `cancelled` or
the milestone no longer applies (e.g. appointment moved). Only then does it
send. A customer opted out of WhatsApp still receives email reminders and
vice versa.

**Why:** reminders are scheduled days in advance. Opt-out or order changes
between schedule time and fire time are the norm, not the exception. Deciding at
schedule time would send stale/unwanted messages. Re-check on fire.

## 4. Provider Integration (grounded in the installed skills)

### ADR-3 — WhatsApp reminders MUST use approved templates, not free text

**Decision:** send reminders via **Kapso message templates** (UTILITY category),
not `sendText`.

**Why (hard platform constraint, from `integrate-whatsapp` SKILL.md):** free-text
/`sendText` requires an *active 24-hour customer-initiated session window*.
Reminders are proactive, unsolicited, and by definition out-of-window — the skill
states plainly: *"For outbound notifications outside the window, use templates."*
Templates must be pre-created and Meta-approved (`create-template.mjs` →
`template-status.mjs`). SDK: `@kapso/whatsapp-cloud-api`,
`new WhatsAppClient({ baseUrl: "https://api.kapso.ai/meta/whatsapp", kapsoApiKey })`,
then a template send (`send-template` path). Requires `phone_number_id`.

**Consequence / dependency:** Meta template approval is an **external gate** and a
v1 blocker *for the WhatsApp channel specifically*. Email (Resend) has no such
gate. So the delivery seam (channel wrappers behind `reminders/providers/`) lets
**email ship first** and WhatsApp light up once templates are approved — the
`reminder.channel` enum + per-channel rows already model this. Recommend two
UTILITY templates: `appointment_reminder`, `service_due_reminder` (NAMED params
per skill rules).

### ADR-4 — Resend via the npm SDK in-process, NOT the `resend` CLI

**Decision:** the reminder worker sends email with the `resend` **Node SDK**
(`new Resend(env.RESEND_API_KEY).emails.send({ from, to, subject, html })`),
wrapped in `reminders/providers/email.ts`.

**Why:** the installed `resend-cli` skill is a *terminal/CI* tool. The reminder
worker runs **inside the Node server process** (pg-boss `boss.work`); shelling
out to a CLI subprocess per reminder is fragile (PATH, auth-profile resolution,
parsing JSON off stdout, process spawn cost) and adds a process boundary for zero
benefit. The SDK is the correct in-process integration. Env: `RESEND_API_KEY` +
`RESEND_FROM` (verified sending domain). Install `resend` as a dependency.

### Env additions (`src/shared/config/env.ts`, same `required`/`optional` pattern)

```ts
RESEND_API_KEY: optional("RESEND_API_KEY"),
RESEND_FROM: optional("RESEND_FROM"),
KAPSO_API_KEY: optional("KAPSO_API_KEY"),
KAPSO_PHONE_NUMBER_ID: optional("KAPSO_PHONE_NUMBER_ID"),
KAPSO_TEMPLATE_APPOINTMENT: optional("KAPSO_TEMPLATE_APPOINTMENT"),
KAPSO_TEMPLATE_SERVICE_DUE: optional("KAPSO_TEMPLATE_SERVICE_DUE"),
```
Add `RESEND_API_KEY` and `KAPSO_API_KEY` to `SENSITIVE_ENV_KEYS` (NFR-4 —
never log/expose, same bar as `IFX_TOKEN`). All `optional` so the app still boots
without CRM providers configured; the worker no-ops gracefully (marks reminder
`skipped`/`failed` with a clear reason) if a channel's env is missing.

## 5. pg-boss Job Design (mirrors `inventory-sync/job.ts` exactly)

New module `src/modules/reminders/job.ts`:

```ts
export const REMINDER_SEND_JOB = "reminder-send";

async function ensureQueue(boss: PgBoss) {           // identical to inventory-sync
  await boss.createQueue(REMINDER_SEND_JOB);
}

// Called from service-orders/service.ts when an order is created/updated.
export async function scheduleReminder(row: Reminder, deps = {}) {
  const boss = await getBoss();
  await ensureQueue(boss);
  const jobId = await boss.sendAfter(
    REMINDER_SEND_JOB,
    { reminderId: row.id },
    { retryLimit: 3, retryDelay: 60, retryBackoff: true, deadLetter: REMINDER_DLQ },
    row.scheduledFor,          // concrete Date — ADR-1
  );
  // persist jobId back onto the reminder row for later cancellation/correlation
}

export async function runReminder(reminderId: string, deps = {}) {
  // load reminder + orden + cliente; ADR-5 re-check (opt-out / cancelled / stale);
  // dispatch to providers/email.ts or providers/whatsapp.ts by row.channel;
  // update row -> sent | skipped | opted_out (R26, distinct from skipped) | failed(+error).
  // Throw on transient failure so pg-boss retries (retryLimit above); terminal
  // failures set status=failed and return.
}

export async function cancelReminder(reminderId: string) {
  // flip row -> cancelled and remove the pending pg-boss job via stored jobId.
}

export async function registerReminderWorker() {     // mirrors registerInventorySyncWorker
  const boss = await getBoss();
  await ensureQueue(boss);
  await boss.work(REMINDER_SEND_JOB, { localConcurrency: 1 }, async ([job]) => {
    await runReminder(job.data.reminderId);
  });
}
```

- **`localConcurrency`, not `teamSize`** — the repo already documents that
  pg-boss 12.26.2 renamed this (see `inventory-sync/job.ts` line 186-188). Reuse
  the same option to avoid the identical mistake.
- **Retry/failure:** `retryLimit: 3` + `retryBackoff` + a `deadLetter` queue, so
  a transient provider outage retries and a permanently-failing reminder lands in
  a DLQ instead of looping. `runReminder` throws on transient errors (provider
  5xx/network) to trigger retry, and swallows+records terminal ones (opt-out,
  bad address) as `skipped`/`failed`.
- **Idempotency against pg-boss retries (ADR-8):** `retryLimit: 3` means
  `runReminder` can re-run after a *partial* failure — the provider call
  succeeds (customer already got the WhatsApp/email) but the DB write that
  marks the row `sent` throws (transient connection blip) before returning.
  Without a guard, the retry re-sends the same message to the customer. Fix:
  `runReminder` re-loads the row FIRST and no-ops (returns immediately) if
  `status !== 'scheduled'` — the provider call and the `status='sent'` write
  happen as close together as possible, and any retry short-circuits on the
  already-`sent` check before touching the provider again. This is the same
  class of bug as an at-least-once delivery system re-doing a side effect on
  retry (analogous to a webhook redelivery causing a duplicate downstream
  call) — the fix here is the same shape: check current state before acting,
  not just "retry the whole function."
- **Bootstrap:** add `registerReminderWorker()` to `registerNodeWorkers()` in
  `src/instrumentation-node.ts` (where the other 3 workers start eagerly at boot).
  No `schedule()` call is added there — reminders are enqueued on demand by
  `service-orders/service.ts`, unlike the weekly sync.

### Pure timing logic — `src/modules/reminders/schedule.ts` (DB-free, unit-tested first)

```ts
export const APPOINTMENT_LEAD_HOURS = 24;   // module constant, tunable — mirrors WEEKLY_CRON's "placeholder w/ comment" convention
export const SERVICE_DUE_AFTER_DAYS = 90;

// Pure: given an order + cliente, return the reminder rows to create
// (which types, which channels, what scheduledFor). No DB, no pg-boss.
export function planReminders(order, cliente, now): PlannedReminder[]
```
`planReminders` decides channels from available contact data + `whatsappOptOut`/`emailOptOut` (each channel is planned independently — a customer can be opted out of one and still get the other)
and computes `scheduledFor` (appointment: `appointmentAt - APPOINTMENT_LEAD_HOURS`;
service_due: `completedAt + SERVICE_DUE_AFTER_DAYS`). It skips a channel with no
address (no email → no email reminder). Past-due timestamps are dropped. This is
the unit-test surface, same as `selection.ts`/`transitions.ts`.

## 6. Service-Order Status Transitions — `src/modules/service-orders/transitions.ts`

Pure, unit-tested first (mirrors `selection.ts`'s `CatalogSelectionValidationError`):

```ts
export class OrderTransitionError extends Error { constructor(public errors: Record<string,string>) {...} }

const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  open:        ["in_progress", "cancelled"],
  in_progress: ["done", "cancelled"],
  done:        [],          // terminal
  cancelled:   [],          // terminal
};
export function assertTransition(from: OrderStatus, to: OrderStatus): void
```
Side effects driven by the transition (in `service.ts`, not the pure fn):
`-> done` sets `completedAt` and schedules the `service_due` reminder;
`-> cancelled` cancels all this order's pending reminders (ADR-2 `cancelReminder`).

## 7. API Routes (mirror `api/inventory-sync/manual/route.ts`)

Every route: `requireSession(request)` first, then business call, DI via optional
`deps` param on a separate exported handler (the `handleX` split that satisfies
Next's exact route-handler signature — copied from the manual-sync route).

| Route | Method | Purpose |
|-------|--------|---------|
| `api/customers/route.ts` | `POST` | create cliente (body validated by `customers/validation.ts`) |
| `api/customers/[id]/route.ts` | `PATCH` | edit cliente / toggle `whatsappOptOut`/`emailOptOut` independently |
| `api/service-orders/route.ts` | `POST` | create order + line items; plans+schedules reminders |
| `api/service-orders/[id]/route.ts` | `PATCH` | update fields / drive status transition |

**Auth level:** staff-only via the existing `requireSession` blanket guard — same
as `inventory-view` (proposal: "staff-only, reuses existing session auth", no
admin sub-gate). *Decision:* do NOT add new `policy.ts` actions for v1. Seam
noted: if a future requirement restricts these to admins, add
`customers.manage` / `orders.manage` actions to `policy.ts` and gate with
`can()` exactly like `sync.manual` — cheap to add later, premature now.

Reads are NOT routes — customer/order lists and details are **server components**
calling `queries.ts` directly (the `inventory/page.tsx` pattern). Reminders have
no public route in v1; they are a server-side side effect of order create/update.

## 8. Pages & Components

### Server-component pages (read) — mirror `inventory/page.tsx`

- `app/(app)/customers/page.tsx` — `searchParams: Promise<SearchParams>`,
  `requireSessionFromHeaders()`, `Promise.all([listCustomers, countCustomers])`,
  `Card`+`CardContent`+`Table`, `<Pagination hrefPattern={...}/>`, empty-state
  card, `PAGE_HEADING`. Name/phone/plate filter card like `InventoryFilters`.
- `app/(app)/customers/[id]/page.tsx` — customer info `Card` + **service history**
  `Table` (their `orden_servicio` rows), each linking to the order detail.
- `app/(app)/service-orders/page.tsx` — same shape; status-filter select;
  Pagination.
- `app/(app)/service-orders/[id]/page.tsx` — order header, line-items table,
  status-transition controls, scheduled-reminders list.

### Client forms — mirror `CatalogBuilderForm.tsx`

- `customers/CustomerForm.tsx` — `"use client"`, `useState` for fields +
  `errors: Record<string,string>`, shadcn `Dialog` + `Input` + `Label` +
  `Button`, `FIELD_ERROR` class for messages, `POST`/`PATCH` to the routes.
- `service-orders/ServiceOrderForm.tsx` — select customer, add parts (search
  `producto` — reuse the `Table`/search idiom from the builder), set
  `appointmentAt`, submit. Parts picker reuses builder search conventions; no new
  component pattern.
- Reuse the **existing** `Pagination` (`onPageChange` mode inside client forms,
  `hrefPattern` mode on server pages — both already supported), `Dialog`,
  `Card`, `Table`, `Select`, `Checkbox`, `Input`, `Label`, `Button`,
  `badge`/`StatusBadge` for order + reminder status pills.

### Navigation

`src/components/app-sidebar.tsx` — add "Clientes" and "Órdenes de servicio" nav
entries next to the existing ones (mechanical; follows the current entry shape).

## 9. Data Flow (end to end)

```
Staff creates order (ServiceOrderForm)
  → POST /api/service-orders  (requireSession)
    → service-orders/service.ts: validate → insert orden_servicio + items (tx)
      → reminders/schedule.ts planReminders(order, cliente, now)  [pure]
      → insert reminder rows (status=scheduled)
      → reminders/job.ts scheduleReminder(row) → boss.sendAfter(date)  [ADR-1]
        → store returned jobId on the row

... time passes; scheduledFor arrives ...

pg-boss worker (registerReminderWorker, boot)
  → runReminder(reminderId)
    → reload reminder + orden + cliente
    → ADR-5 re-check: opt-out? → status=opted_out, stop (R26)
                      cancelled? stale? → status=skipped, stop
    → dispatch by channel:
        email    → providers/email.ts  (Resend SDK)      [ADR-4]
        whatsapp → providers/whatsapp.ts (Kapso template) [ADR-3]
    → success → status=sent, sentAt=now
    → transient failure → throw → pg-boss retry (x3, backoff) → DLQ
    → terminal failure → status=failed, error=...

Staff moves order → done   → completedAt set, schedule service_due reminder
Staff moves order → cancelled → cancelReminder() for all pending rows
```

## 10. Decisions Summary (ADR index)

| ADR | Decision | Key rejected alternative |
|-----|----------|--------------------------|
| 1 | `sendAfter(date)` one-shot jobs for reminders | `schedule()` cron (wrong semantics); table-polling cron (redundant) |
| 2 | `reminder` table = truth, pg-boss = transport | trusting pg-boss job rows (opaque, pruned, uncancellable-by-us) |
| 3 | WhatsApp via approved **templates** | `sendText` (blocked outside 24h session window) |
| 4 | Resend **npm SDK** in-process | shelling to `resend` CLI (fragile process boundary) |
| 5 | Opt-out/order-state re-check at **fire time**, per channel (`whatsappOptOut`/`emailOptOut` independent); opt-out records `opted_out`, distinct from `skipped` (R26) | deciding at schedule time (sends stale/unwanted msgs); single combined opt-out flag (spec R26 requires per-channel); conflating opt-out with generic `skipped` |
| 6 | Inline single vehicle on `cliente`; FK `restrict` on order→cliente | separate `vehiculo` table now (YAGNI v1; seam noted) |
| 7 | `orden_servicio_item` line-item table + **price/name snapshot** | JSONB parts blob (loses "which orders used part X"); live FK w/o snapshot (re-sync rewrites history) |
| 8 | `runReminder` re-checks row status before acting (idempotent against pg-boss retry) | trusting `retryLimit` alone (retry-after-partial-failure can re-send a message the customer already received) |

## 11. Risks / Open Points for Tasks & Apply

- **WhatsApp template approval is an external Meta gate.** Email can ship first;
  WhatsApp channel goes live only after `appointment_reminder` /
  `service_due_reminder` UTILITY templates are approved. Sequence tasks so the
  email path and the WhatsApp path are independently completable.
- **Provider credentials pending** (proposal dependency): `RESEND_API_KEY` +
  verified domain; `KAPSO_API_KEY` + `phone_number_id`. All env vars are
  `optional` so absence degrades gracefully (reminder → `failed`/`skipped` with
  reason), never crashes boot.
- **`cancelReminder` mechanics for `sendAfter` jobs** — pg-boss `unschedule` is
  for crons; for one-shot jobs we cancel via the stored `jobId` (pg-boss job
  deletion / `cancel` API). Apply phase must confirm the exact 12.26.2 cancel
  call and add a test; until then the fire-time re-check (ADR-5) is the safety net
  that prevents a cancelled order's reminder from actually sending.
- **Phone format for WhatsApp** — Kapso needs E.164 `to`. `customers/validation.ts`
  should normalize/validate phone on write; malformed phone → WhatsApp channel
  skipped, email still sent.
- **Strict TDD** is active: `validation.ts`, `transitions.ts`, `schedule.ts`
  (all pure) get tests first; `queries.ts`/`service.ts`/`job.ts`/providers get
  the DI-`deps` seam (like `inventory-sync/job.ts` and the manual-sync route) so
  they are testable with injected fakes.
```
