/**
 * reminders/schedule.ts — pure reminder-timing logic (R23). No DB, no
 * pg-boss — mirrors `service-orders/transitions.ts`'s pure-function-first
 * convention so this file is unit-testable without Postgres (design.md §5
 * "Pure timing logic").
 */
import type { Cliente, OrdenServicio } from "@/shared/db/schema";

/** Module constants — tunable, same "placeholder w/ comment" convention as inventory-sync/job.ts's WEEKLY_CRON. */
export const APPOINTMENT_LEAD_HOURS = 24;
export const SERVICE_DUE_AFTER_DAYS = 90;
/** REVISADO is Panama's mandatory ANNUAL ATTT inspection — a year, not a quarter. */
export const SERVICE_DUE_ANNUAL_AFTER_DAYS = 365;

/**
 * How long after completion a `service_due` reminder follows, PER CATEGORY —
 * and the single place that decision is written down. A category absent from
 * this map gets no `service_due` at all, which is how `instalacion` and
 * `reparacion` keep getting none.
 *
 * A `Map`, not an object literal, on purpose. This repo shipped a real defect
 * from indexing an object literal with a string: the lookup walked the
 * prototype chain and `"constructor"` returned `Object`. A `Map` has no
 * prototype chain and `.get()` returns `undefined` for anything unmapped, so
 * the "no reminder" branch cannot be reached by an accidental hit — a hit here
 * would otherwise be `NaN * DAY_MS`, an `Invalid Date` scheduled for a
 * customer.
 *
 * Typed off the SCHEMA enum, deliberately not off
 * `service-orders/categories.ts`. `service-orders` depends on `reminders`;
 * importing back would reverse that and create a cycle for a list of three
 * strings. The test drives the same keys from `CATEGORIA_LABEL`, which is where
 * a new category would have to be declared anyway.
 */
const SERVICE_DUE_DAYS_BY_CATEGORY = new Map<OrdenServicio["categoria"], number>([
  ["mant_preventivo", SERVICE_DUE_AFTER_DAYS],
  ["mant_correctivo", SERVICE_DUE_AFTER_DAYS],
  ["revisado", SERVICE_DUE_ANNUAL_AFTER_DAYS],
]);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type ReminderType = "appointment" | "service_due";
export type ReminderChannel = "email" | "whatsapp";

export type PlannedReminder = {
  ordenId: string;
  clienteId: string;
  type: ReminderType;
  channel: ReminderChannel;
  scheduledFor: Date;
};

/**
 * R23 — given an order + cliente snapshot and `now`, returns every reminder
 * (type x channel) that should exist right now:
 * - `appointment`  = `order.appointmentAt - APPOINTMENT_LEAD_HOURS` (only if `appointmentAt` is set)
 * - `service_due`  = `order.completedAt + <that categoria's interval>` (only if `completedAt` is set
 *                    AND `categoria` appears in `SERVICE_DUE_DAYS_BY_CATEGORY` — 90 days for
 *                    preventive/corrective maintenance, 365 for `revisado`'s annual ATTT inspection)
 *
 * A channel is skipped when the cliente has no contact info for it (no
 * `phone` -> no whatsapp, no `email` -> no email) OR that channel's opt-out
 * flag is true (R26 — each channel is independent; opting out of one does
 * not affect the other). Any computed `scheduledFor` that is already <=
 * `now` is dropped entirely — a stale reminder must never fire (R23).
 *
 * Callers (service-orders/service.ts) decide WHICH of the returned types to
 * actually persist+schedule for a given event (e.g. only `appointment` plans
 * matter when an order is created/updated with an appointment date; only
 * `service_due` matters when an order transitions to `done`) — this function
 * itself only answers "what reminders are due, given this snapshot".
 */
export function planReminders(order: OrdenServicio, cliente: Cliente, now: Date): PlannedReminder[] {
  const plans: PlannedReminder[] = [];

  const plan = (type: ReminderType, scheduledFor: Date): void => {
    if (scheduledFor.getTime() <= now.getTime()) return;

    if (cliente.phone && !cliente.whatsappOptOut) {
      plans.push({ ordenId: order.id, clienteId: cliente.id, type, channel: "whatsapp", scheduledFor });
    }
    if (cliente.email && !cliente.emailOptOut) {
      plans.push({ ordenId: order.id, clienteId: cliente.id, type, channel: "email", scheduledFor });
    }
  };

  if (order.appointmentAt) {
    plan("appointment", new Date(order.appointmentAt.getTime() - APPOINTMENT_LEAD_HOURS * HOUR_MS));
  }
  const serviceDueDays = SERVICE_DUE_DAYS_BY_CATEGORY.get(order.categoria);
  if (order.completedAt && serviceDueDays !== undefined) {
    plan("service_due", new Date(order.completedAt.getTime() + serviceDueDays * DAY_MS));
  }

  return plans;
}
