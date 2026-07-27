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

import { db } from "@/shared/db/client";
import { cliente, ordenServicio, reminder, type Cliente, type OrdenServicio, type Reminder } from "@/shared/db/schema";
import { getBoss } from "@/shared/jobs/boss";
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
   * Phase 7 seam: dispatches to providers/email.ts or providers/whatsapp.ts
   * by `ctx.reminder.channel`. This PR (Phase 4) does not implement the real
   * provider calls yet — see the default below.
   */
  sendViaChannel?: SendViaChannel;
};

/** Phase 4 stand-in until Phase 7 wires the real Resend/Kapso calls (ADR-3/ADR-4). */
async function defaultSendViaChannel(): Promise<void> {
  throw new Error("reminders: no provider wired for this channel yet (Phase 7)");
}

/**
 * R23/R25/R26/ADR-5/ADR-8 — the pg-boss worker body. Order of checks matters:
 * 1. ADR-8: reload the row and no-op immediately unless it is still
 *    `scheduled` — this is what makes a pg-boss retry after a PARTIAL
 *    failure (provider send succeeded, the `sent` write didn't) safe against
 *    re-sending the same message.
 * 2. ADR-5/R23/R26: re-check order-cancelled / stale-timing / per-channel
 *    opt-out AT FIRE TIME (not schedule time) — mark `skipped` and stop if
 *    any apply.
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

  if (ctx.orden.status === "cancelled") {
    await markSkipped();
    return;
  }
  if (ctx.reminder.type === "appointment" && (!ctx.orden.appointmentAt || ctx.orden.appointmentAt.getTime() <= now().getTime())) {
    await markSkipped();
    return;
  }
  const optedOut = ctx.reminder.channel === "whatsapp" ? ctx.cliente.whatsappOptOut : ctx.cliente.emailOptOut;
  if (optedOut) {
    await markSkipped();
    return;
  }

  const dispatch = deps.sendViaChannel ?? defaultSendViaChannel;
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
