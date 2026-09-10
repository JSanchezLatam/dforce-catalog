/**
 * reminders/job.ts — pg-boss transport for scheduled reminders (R23-R26).
 * Mirrors `inventory-sync/job.ts`'s exact conventions: `ensureQueue` before
 * every send, `deps.db`/`deps.getBoss` DI seams for testability, and
 * `localConcurrency` (not `teamSize` — pg-boss 12.26.2 renamed it, see
 * inventory-sync/job.ts's own comment on this).
 *
 * ADR-2 (design.md): `reminder` is the source of truth; the pg-boss job
 * payload only ever carries `{ reminderId }` — the worker reloads the row at
 * fire time. ADR-8: `runReminder` re-checks the row's status FIRST and
 * no-ops on anything other than `scheduled`, so a pg-boss retry after a
 * partial failure (provider send succeeded, the `status: 'sent'` write
 * didn't) can never re-send the same message to a customer.
 */
import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";

import { formatDateTime } from "@/shared/datetime";
import { env } from "@/shared/config/env";
import { db } from "@/shared/db/client";
import { cliente, ordenServicio, reminder, type Cliente, type OrdenServicio, type Reminder } from "@/shared/db/schema";
import { getBoss } from "@/shared/jobs/boss";
import { sendEmail } from "./providers/email";
import { sendWhatsAppTemplate } from "./providers/whatsapp";
import type { ReminderType } from "./schedule";

export const REMINDER_SEND_JOB = "reminder-send";
// pg-boss 12.26.2's `deadLetter` queue option (node_modules/pg-boss/dist/types.d.ts
// `Queue`/`JobOptions.deadLetter`) must reference an EXISTING queue name — it
// is not auto-created, so ensureQueue() below creates it explicitly before
// referencing it on the main queue (R24/R25 — a permanently-failing reminder
// lands here instead of retrying forever or being silently dropped).
export const REMINDER_DLQ = "reminder-send-dlq";

async function ensureQueue(boss: PgBoss): Promise<void> {
  // createQueue is an upsert — safe to call on every send/schedule (identical
  // comment/behavior to inventory-sync/job.ts's ensureQueue).
  await boss.createQueue(REMINDER_DLQ);
  await boss.createQueue(REMINDER_SEND_JOB, { deadLetter: REMINDER_DLQ });
}

export type ReminderContext = { reminder: Reminder; orden: OrdenServicio; cliente: Cliente };

/** Real implementation — joins reminder + its orden + its cliente against whichever `database` is passed in. */
async function loadReminderContextFrom(id: string, database: typeof db): Promise<ReminderContext | null> {
  const reminderRows = await database.select().from(reminder).where(eq(reminder.id, id)).limit(1);
  const reminderRow = reminderRows[0];
  if (!reminderRow) return null;

  const ordenRows = await database.select().from(ordenServicio).where(eq(ordenServicio.id, reminderRow.ordenId)).limit(1);
  const ordenRow = ordenRows[0];
  const clienteRows = await database.select().from(cliente).where(eq(cliente.id, reminderRow.clienteId)).limit(1);
  const clienteRow = clienteRows[0];
  if (!ordenRow || !clienteRow) return null;

  return { reminder: reminderRow, orden: ordenRow, cliente: clienteRow };
}

/** DI-testable loader — mirrors customers/queries.ts's injected-queryFn convention. Defaults to the real `db`. */
export async function loadReminderContext(
  id: string,
  queryFn: () => Promise<ReminderContext | null> = () => loadReminderContextFrom(id, db),
): Promise<ReminderContext | null> {
  return queryFn();
}

export type ScheduleReminderDeps = {
  getBoss?: typeof getBoss;
  db?: typeof db;
};

/**
 * R24/ADR-1 — enqueues a one-shot `sendAfter` job for `row.scheduledFor` and
 * persists the returned pg-boss job id back onto the row for later
 * cancellation/correlation (ADR-2).
 */
export async function scheduleReminder(row: Reminder, deps: ScheduleReminderDeps = {}): Promise<string | null> {
  const boss = await (deps.getBoss ?? getBoss)();
  await ensureQueue(boss);

  const jobId = await boss.sendAfter(
    REMINDER_SEND_JOB,
    { reminderId: row.id },
    { retryLimit: 3, retryDelay: 60, retryBackoff: true, deadLetter: REMINDER_DLQ },
    row.scheduledFor,
  );

  const database = deps.db ?? db;
  await database.update(reminder).set({ jobId }).where(eq(reminder.id, row.id));

  return jobId;
}

export type SendViaChannel = (ctx: ReminderContext) => Promise<void>;

export type RunReminderDeps = {
  db?: typeof db;
  now?: () => Date;
  /** Full override of the loader — receives just the reminder id. Defaults to `loadReminderContextFrom(id, deps.db ?? db)`. */
  loadReminderContext?: (id: string) => Promise<ReminderContext | null>;
  /**
   * Dispatches to providers/email.ts or providers/whatsapp.ts by
   * `ctx.reminder.channel`. Defaults to `buildDefaultSendViaChannel` (Phase
   * 7's real Resend/Kapso wiring) — override in tests to inject a fake
   * without touching the provider modules.
   */
  sendViaChannel?: SendViaChannel;
  /** Phase 7 — overrides `env.KAPSO_TEMPLATE_APPOINTMENT`/`KAPSO_TEMPLATE_SERVICE_DUE` for the default `sendViaChannel`. Ignored when `sendViaChannel` is itself overridden. */
  kapsoTemplates?: KapsoTemplateNames;
};

/** Which Kapso template to use for each reminder `type` — defaults to `env.KAPSO_TEMPLATE_APPOINTMENT`/`KAPSO_TEMPLATE_SERVICE_DUE` (ADR-3's two recommended UTILITY templates). Overridable so tests don't depend on ambient env-at-import-time. */
export type KapsoTemplateNames = { appointment?: string; service_due?: string };

/**
 * A `service_due` reminder for a `revisado` order fires 365 days after the
 * work, not 90 (`schedule.ts`'s `SERVICE_DUE_DAYS_BY_CATEGORY`), so it cannot
 * reuse the maintenance copy — that body names its own interval and would be
 * a year out of date on the wire. Branching on `categoria`, which
 * `ReminderContext` already carries, keeps the reminder TYPE (and therefore
 * the Kapso template and the `reminder_type` enum) unchanged.
 */
function isAnnualRevisado(ctx: ReminderContext): boolean {
  return ctx.reminder.type === "service_due" && ctx.orden.categoria === "revisado";
}

function emailSubject(ctx: ReminderContext): string {
  if (ctx.reminder.type === "appointment") return "Recordatorio de cita de servicio";
  if (isAnnualRevisado(ctx)) return "Recordatorio de revisado anual";
  return "Recordatorio de servicio pendiente";
}

function emailHtml(ctx: ReminderContext): string {
  if (ctx.reminder.type === "appointment") {
    const when = ctx.orden.appointmentAt ? formatDateTime(ctx.orden.appointmentAt) : "próximamente";
    return `<p>Hola ${ctx.cliente.name},</p><p>Te recordamos tu cita de servicio programada para ${when}.</p>`;
  }
  if (isAnnualRevisado(ctx)) {
    return `<p>Hola ${ctx.cliente.name},</p><p>Pasó un año desde tu último revisado — ya te toca renovarlo para mantener la placa al día. Escribinos y te agendamos la inspección.</p>`;
  }
  return `<p>Hola ${ctx.cliente.name},</p><p>Ya pasaron 90 días desde tu último servicio — es un buen momento para agendar el próximo mantenimiento.</p>`;
}

/**
 * Phase 7 — real dispatch, replacing the Phase 4 stand-in. Routes by
 * `ctx.reminder.channel` to providers/email.ts (Resend, ADR-4) or
 * providers/whatsapp.ts (Kapso template, ADR-3), building the reminder
 * copy/template params from the reloaded `ctx`. Providers themselves never
 * throw for a graceful "not configured"/SDK-error outcome (they return
 * `{ ok: false, reason }`) — THIS function is the seam that converts that
 * into a throw, preserving runReminder's existing "mark failed + rethrow so
 * pg-boss retries" contract (R25) for every failure mode, config-missing
 * included (retrying won't fix a missing credential, but it does land the
 * reminder in the DLQ after `retryLimit` attempts instead of silently
 * dropping it — same DLQ safety net as any other failure).
 */
function buildDefaultSendViaChannel(kapsoTemplates?: KapsoTemplateNames): SendViaChannel {
  return async (ctx: ReminderContext): Promise<void> => {
    if (ctx.reminder.channel === "email") {
      if (!ctx.cliente.email) {
        throw new Error("reminders: cliente has no email address for an email reminder");
      }
      const result = await sendEmail({ to: ctx.cliente.email, subject: emailSubject(ctx), html: emailHtml(ctx) });
      if (!result.ok) throw new Error(`reminders: email send failed — ${result.reason}`);
      return;
    }

    // whatsapp
    if (!ctx.cliente.phone) {
      throw new Error("reminders: cliente has no phone number for a whatsapp reminder");
    }
    const templateName =
      ctx.reminder.type === "appointment"
        ? (kapsoTemplates?.appointment ?? env.KAPSO_TEMPLATE_APPOINTMENT)
        : (kapsoTemplates?.service_due ?? env.KAPSO_TEMPLATE_SERVICE_DUE);
    if (!templateName) {
      throw new Error(`reminders: no Kapso template configured for reminder type "${ctx.reminder.type}"`);
    }
    const result = await sendWhatsAppTemplate({
      // Stored raw; `providers/whatsapp.ts`'s `toE164` puts it on the wire.
      to: ctx.cliente.phone,
      templateName,
      bodyParams: [{ parameterName: "customer_name", text: ctx.cliente.name }],
    });
    if (!result.ok) throw new Error(`reminders: whatsapp send failed — ${result.reason}`);
  };
}

/**
 * R23/R25/R26/ADR-5/ADR-8 — the pg-boss worker body. Order of checks matters:
 * 1. ADR-8: reload the row and no-op immediately unless it is still
 *    `scheduled` — this is what makes a pg-boss retry after a PARTIAL
 *    failure (provider send succeeded, the `sent` write didn't) safe against
 *    re-sending the same message.
 * 2. ADR-5/R23/R26: re-check order-cancelled / stale-timing / per-channel
 *    opt-out AT FIRE TIME (not schedule time) — mark `skipped` (cancelled
 *    order, stale timing) or `opted_out` (per-channel opt-out, R26 — a
 *    distinct outcome so it is never conflated with an operational skip or
 *    a delivery `failed`) and stop if any apply.
 * 3. Dispatch via the injectable `sendViaChannel` seam; mark `sent` on
 *    success, `failed`(+error) and RETHROW on failure so pg-boss's native
 *    retry (retryLimit:3, backoff, DLQ) takes over (R25).
 */
export async function runReminder(reminderId: string, deps: RunReminderDeps = {}): Promise<void> {
  const database = deps.db ?? db;
  const now = deps.now ?? (() => new Date());
  const loadContext = deps.loadReminderContext ?? ((id: string) => loadReminderContextFrom(id, database));

  const ctx = await loadContext(reminderId);
  if (!ctx) return; // reminder row no longer exists — nothing to act on

  // ADR-8 — idempotency guard FIRST, before any provider call.
  if (ctx.reminder.status !== "scheduled") return;

  const markSkipped = () => database.update(reminder).set({ status: "skipped" }).where(eq(reminder.id, reminderId));
  // R26 — distinct from `skipped`: a per-channel opt-out is a customer
  // consent decision, not an operational skip reason (cancelled order,
  // stale timing), so it gets its own status.
  const markOptedOut = () => database.update(reminder).set({ status: "opted_out" }).where(eq(reminder.id, reminderId));

  if (ctx.orden.status === "cancelled") {
    await markSkipped();
    return;
  }
  // R20 — the workshop retired this customer, so nothing goes out to them.
  // `markSkipped`, NOT `markOptedOut`: `opted_out` records a consent decision
  // the CUSTOMER made per channel and carries legal meaning, while this is an
  // operational state of the record, exactly like the cancelled order above.
  //
  // At fire time, like every guard here. Deactivation almost always happens
  // after the orders and their reminders already exist, so a schedule-time
  // check would miss the only case that actually occurs.
  if (ctx.cliente.deactivatedAt) {
    await markSkipped();
    return;
  }
  if (ctx.reminder.type === "appointment" && (!ctx.orden.appointmentAt || ctx.orden.appointmentAt.getTime() <= now().getTime())) {
    await markSkipped();
    return;
  }
  const optedOut = ctx.reminder.channel === "whatsapp" ? ctx.cliente.whatsappOptOut : ctx.cliente.emailOptOut;
  if (optedOut) {
    await markOptedOut();
    return;
  }

  const dispatch = deps.sendViaChannel ?? buildDefaultSendViaChannel(deps.kapsoTemplates);
  try {
    await dispatch(ctx);
    await database.update(reminder).set({ status: "sent", sentAt: now() }).where(eq(reminder.id, reminderId));
  } catch (error) {
    await database.update(reminder).set({ status: "failed", error: String(error) }).where(eq(reminder.id, reminderId));
    throw error;
  }
}

export type CancelReminderDeps = {
  getBoss?: typeof getBoss;
  db?: typeof db;
};

/** Shared by cancelReminder/cancelRemindersForOrder — removes the pg-boss job (if any) then flips the row. */
async function performCancel(row: Reminder, database: typeof db, deps: CancelReminderDeps): Promise<void> {
  if (row.jobId) {
    const boss = await (deps.getBoss ?? getBoss)();
    await boss.deleteJob(REMINDER_SEND_JOB, row.jobId);
  }
  await database.update(reminder).set({ status: "cancelled" }).where(eq(reminder.id, row.id));
}

/** ADR-2 — flips the row to `cancelled` and removes the pending pg-boss job via the stored `jobId` (job deletion, not `cancel()` — design.md ADR-2). */
export async function cancelReminder(reminderId: string, deps: CancelReminderDeps = {}): Promise<void> {
  const database = deps.db ?? db;
  const rows = await database.select().from(reminder).where(eq(reminder.id, reminderId)).limit(1);
  const row = rows[0];
  if (!row || row.status === "cancelled") return;

  await performCancel(row, database, deps);
}

/**
 * R23 — bulk-cancels every still-`scheduled` reminder for an order (optionally
 * filtered by `type`). Used by service-orders/service.ts's task 4.5 wiring:
 * `-> cancelled` cancels ALL pending reminders; an `appointmentAt` change
 * cancels only the pending `appointment` ones before scheduling a new one.
 */
export async function cancelRemindersForOrder(
  ordenId: string,
  type: ReminderType | undefined,
  deps: CancelReminderDeps = {},
): Promise<void> {
  const database = deps.db ?? db;
  const conditions = [eq(reminder.ordenId, ordenId), eq(reminder.status, "scheduled")];
  if (type) conditions.push(eq(reminder.type, type));

  const rows = await database
    .select()
    .from(reminder)
    .where(and(...conditions));

  for (const row of rows) {
    await performCancel(row, database, deps);
  }
}

export type RegisterReminderWorkerDeps = { getBoss?: typeof getBoss };

/** Mirrors `registerInventorySyncWorker` exactly, at `localConcurrency: 1`. */
export async function registerReminderWorker(deps: RegisterReminderWorkerDeps = {}): Promise<void> {
  const boss = await (deps.getBoss ?? getBoss)();
  await ensureQueue(boss);
  await boss.work(REMINDER_SEND_JOB, { localConcurrency: 1 }, async ([job]) => {
    await runReminder((job.data as { reminderId: string }).reminderId);
  });
}
