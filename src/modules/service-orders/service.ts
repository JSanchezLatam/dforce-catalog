/**
 * service-orders/service.ts — validation + DB-write orchestration for
 * `orden_servicio` (R20-R22). Mirrors customers/service.ts's DI-`deps` shape
 * for the referential check (unknown clienteId) and inventory-sync/job.ts's
 * `runSync`'s `deps.db` transaction seam for the create-order+items write.
 *
 * R22 — this module NEVER touches `producto.stock`. Attaching a part to an
 * order only inserts an `orden_servicio_item` row (a record-only snapshot);
 * `producto` is not written anywhere in this file. See design.md §"Parts
 * Usage Recording" and the app-wide precedent in inventory-sync/job.ts,
 * where `producto.stock` is the ONLY writer (wholesale overwrite on sync).
 *
 * Phase 4 (R23) — reminder wiring: design.md §6 and §9 (data flow) and
 * tasks.md task 4.5 are explicit that this side-effect belongs HERE, in
 * service.ts, not behind an external composition point — service-orders
 * directly depends on reminders/{schedule,job}.ts (never the other way
 * around, so there's no import cycle). The Phase 3 `onTransitioned` DI hook
 * is kept as a general-purpose extension seam (still called, still no-op by
 * default), but the concrete "schedule service_due on -> done" / "cancel all
 * pending on -> cancelled" / "reschedule appointment reminder on
 * appointmentAt change" behaviors are wired as first-class steps below, each
 * behind its own DI-overridable `deps` entry (mirrors this file's existing
 * `deps.db`/`deps.getClienteById` convention) so unit tests never need a
 * real DB or pg-boss connection.
 */
import { eq } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { ordenServicio, ordenTecnico, reminder, type Cliente, type OrdenServicio } from "@/shared/db/schema";
import { getClienteById } from "@/modules/customers/queries";
import { ClienteDeactivatedError } from "@/modules/customers/service";
import { cancelRemindersForOrder, scheduleReminder } from "@/modules/reminders/job";
import { planReminders, type ReminderType } from "@/modules/reminders/schedule";
import { isServiceCategory, type ServiceCategory } from "./categories";
import type { IntakeValues } from "./intake";
import type { Role } from "@/modules/auth/roles";
import { canEditOrderFields } from "./edit-policy";
import { assertActiveTecnicos } from "./assignments";
import { SYSTEM_SCOPE, type OrderScope } from "./scope";
import { lockOrderForMutation, recordCorrections, type CorrectionGrant } from "./order-lock";
import { assertTransition, assertTransitionPermitted, type OrderStatus } from "./transitions";

/**
 * Shared by createOrder/transitionOrder/updateOrder (R23) — plans reminders
 * for `order`+`clienteRow` at `deps.now()`, keeps only the ones matching
 * `reminderType` (a single event only ever cares about one type: order
 * create/appointmentAt-change -> "appointment", -> done -> "service_due"),
 * persists each as a `reminder` row (status defaults to "scheduled"), and
 * hands it to `scheduleReminder` (pg-boss `sendAfter`, ADR-1).
 */
async function planAndScheduleReminders(
  order: OrdenServicio,
  clienteRow: Cliente,
  reminderType: ReminderType,
  deps: ReminderWiringDeps,
): Promise<void> {
  const plan = deps.planReminders ?? planReminders;
  const now = deps.now ?? (() => new Date());
  const plans = plan(order, clienteRow, now()).filter((p) => p.type === reminderType);

  const database = deps.db ?? db;
  const schedule = deps.scheduleReminder ?? scheduleReminder;
  for (const planned of plans) {
    const [row] = await database.insert(reminder).values(planned).returning();
    await schedule(row, deps);
  }
}

export type ReminderWiringDeps = {
  db?: typeof db;
  now?: () => Date;
  getClienteById?: typeof getClienteById;
  planReminders?: typeof planReminders;
  scheduleReminder?: typeof scheduleReminder;
  cancelRemindersForOrder?: typeof cancelRemindersForOrder;
};

/** R20 — thrown when `clienteId` does not reference an existing cliente. */
export class UnknownClienteError extends Error {
  constructor(public readonly clienteId: string) {
    super(`Cliente ${clienteId} not found`);
  }
}

export class OrdenServicioNotFoundError extends Error {
  constructor(id: string) {
    super(`Service order ${id} not found`);
  }
}

/**
 * C4 — thrown when `vehiculoId` does not resolve to one of `input.clienteId`'s
 * OWN active vehicles: unknown id, another customer's vehicle (cross-ownership
 * trust boundary, not merely a missing-record check), or an inactive one (the
 * picker cannot offer one, so this is a deliberate tightening at create time).
 * One error for all three — the ownership check is a single array lookup
 * against `clienteDetail.vehicles`, already fetched for `UnknownClienteError`.
 */
export class InvalidVehiculoError extends Error {
  constructor(readonly errors: { vehiculoId: string }) {
    super("Invalid vehiculo");
  }
}

/**
 * `createOrder` receives `await request.json()` — the `CreateOrdenServicioInput`
 * type is a claim about that body, not a fact, and it is erased at runtime.
 * `clienteId` and `vehiculoId` are both checked here and answer 400; without
 * this `categoria` was the one field next to them that reached Postgres raw
 * and came back a 500 (`22P02` when bogus, `23502` when omitted).
 */
export class InvalidCategoriaError extends Error {
  constructor(readonly errors: { categoria: string }) {
    super("Invalid categoria");
  }
}

export type CreateOrdenServicioInput = {
  clienteId: string;
  vehiculoId: string;
  categoria: ServiceCategory;
  description?: string | null;
  /**
   * D7 — what the CUSTOMER reported at booking, so it is known before anyone
   * has looked at the vehicle and is settable here. `hallazgos` and
   * `recomendaciones` are findings and remain patch-only (`updateOrder`).
   */
  observaciones?: string | null;
  appointmentAt?: Date | null;
  createdBy?: string | null;
  /** Zero or more active roster ids, assigned in the creating transaction. `createdBy` stamps them. */
  tecnicoIds?: readonly string[];
} & IntakeValues;

export type CreateOrdenServicioDeps = ReminderWiringDeps;

/**
 * R20 — creates the order. Rejects unknown `clienteId` BEFORE opening the
 * transaction. Never writes to `producto`.
 *
 * D7 — no line items: creation stopped accepting them when `Piezas` came out
 * of the intake dialog, and `ordenServicioItem` has no writer left anywhere.
 * The table and the detail page's "Piezas utilizadas" card both stay, for the
 * rows that already exist and for a later record-what-was-used flow.
 *
 * R23 — if `appointmentAt` is given, an `appointment` reminder is planned +
 * persisted + scheduled AFTER the transaction commits (never inside it — the
 * DB insert must not roll back an already-enqueued pg-boss job, and a
 * pg-boss enqueue must not happen for an order that never actually got
 * created).
 */
export async function createOrder(
  input: CreateOrdenServicioInput,
  deps: CreateOrdenServicioDeps = {},
): Promise<OrdenServicio> {
  const findCliente = deps.getClienteById ?? getClienteById;
  // SYSTEM_SCOPE: this reads the customer row and vehicles; the order history it also returns is unused here.
  const clienteDetail = await findCliente(input.clienteId, SYSTEM_SCOPE);
  if (!clienteDetail) {
    throw new UnknownClienteError(input.clienteId);
  }

  // R20/D5 — "server-side, not only hidden in the UI". `getClienteById`
  // deliberately returns a deactivated customer (reactivation has to open the
  // record), so existence alone is not enough here. The picker's exclusion is
  // a convenience, not the guarantee: staff A opens "Nueva orden" and picks
  // Juan, staff B deactivates Juan, staff A submits. Without this the order is
  // created against a retired customer whose reminders then log `skipped` and
  // who only appears behind `?includeInactive=1`.
  //
  // Five lines below, the same function already refuses a soft-deleted
  // VEHICLE. This is the customer's missing half of that rule.
  if (clienteDetail.cliente.deactivatedAt) {
    throw new ClienteDeactivatedError(input.clienteId);
  }

  // C4 — ownership check reuses clienteDetail.vehicles, already fetched above
  // for the unknown-cliente check: zero extra queries. Only an ACTIVE vehicle
  // of THIS customer is accepted (design.md's deliberate tightening).
  const ownsVehicle = clienteDetail.vehicles?.some((v) => v.id === input.vehiculoId && v.deactivatedAt === null);
  if (!ownsVehicle) {
    throw new InvalidVehiculoError({ vehiculoId: "Seleccioná un vehículo válido de este cliente" });
  }

  if (!isServiceCategory(input.categoria)) {
    throw new InvalidCategoriaError({ categoria: "Elegí un tipo de servicio válido" });
  }

  const database = deps.db ?? db;

  const tecnicoIds = [...new Set(input.tecnicoIds ?? [])];
  if (tecnicoIds.length > 0 && !input.createdBy) {
    throw new Error("createOrder: assigning technicians needs createdBy");
  }

  const orden = await database.transaction(async (tx) => {
    // Before the order insert, so a refused technician leaves nothing behind.
    if (tecnicoIds.length > 0) await assertActiveTecnicos(tx, tecnicoIds);

    const [inserted] = await tx
      .insert(ordenServicio)
      .values({
        clienteId: input.clienteId,
        vehiculoId: input.vehiculoId,
        categoria: input.categoria,
        description: input.description ?? null,
        observaciones: input.observaciones ?? null,
        appointmentAt: input.appointmentAt ?? null,
        kilometraje: input.kilometraje ?? null,
        nivelCombustible: input.nivelCombustible ?? null,
        bateriaPct: input.bateriaPct ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();

    if (tecnicoIds.length > 0) {
      await tx
        .insert(ordenTecnico)
        .values(tecnicoIds.map((tecnicoId) => ({ ordenId: inserted.id, tecnicoId, assignedBy: input.createdBy! })));
    }

    return inserted;
  });

  if (orden.appointmentAt) {
    await planAndScheduleReminders(orden, clienteDetail.cliente, "appointment", deps);
  }

  return orden;
}

export type UpdateOrdenServicioPatch = {
  description?: string | null;
  appointmentAt?: Date | null;
  categoria?: ServiceCategory;
  hallazgos?: string | null;
  recomendaciones?: string | null;
  observaciones?: string | null;
} & IntakeValues;

export type UpdateOrdenServicioDeps = {
  /** The acting role: each caller's own write rule, evaluated against the LOCKED row's status. */
  role: Role;
  /** The caller's `orderScope(user)`: an order outside it is "not found", never a 403. */
  scope: OrderScope;
  /** Issued by `authorizeCorrection` after the password check; the only way to write a closed order. */
  correction?: CorrectionGrant;
} & ReminderWiringDeps;

/**
 * Plain field edits (description/appointmentAt/categoria/notes) — status
 * changes go through transitionOrder(). The row is locked first (`FOR UPDATE`)
 * and its status read from the LOCKED row, so a close that lands between a
 * caller's read and this write is seen; a closed order is written only with a
 * `correction` grant, and then every changed field gets an audit row in the same
 * transaction. R23 — a patch replans reminders on two
 * independent triggers, and "the old and new reminders MUST NOT both fire"
 * (spec R23 scenario) applies to each, AFTER the commit:
 *
 * - `appointmentAt` changes (including being cleared to `null`): any pending
 *   `appointment` reminder is cancelled, then a new one planned+scheduled if
 *   the new value is still set.
 * - `categoria` changes on an order that HAS a `completedAt`: any pending
 *   `service_due` is cancelled and replanned, because its interval is
 *   per-category (`reminders/schedule.ts`) and its email copy is chosen from
 *   `categoria` at FIRE time. Without this, correcting the category of a
 *   finished order leaves a reminder booked at the OLD interval that then
 *   describes the NEW one — a 90-day booking announcing an annual revisado.
 */
export async function updateOrder(
  id: string,
  patch: UpdateOrdenServicioPatch,
  deps: UpdateOrdenServicioDeps,
): Promise<OrdenServicio> {
  const database = deps.db ?? db;
  const { before, updated } = await database.transaction(async (tx) => {
    const { order, correcting } = await lockOrderForMutation(tx, id, {
      scope: deps.scope,
      canWrite: (status) => canEditOrderFields(deps.role, status),
      correction: deps.correction,
    });
    const [row] = await tx.update(ordenServicio).set(patch).where(eq(ordenServicio.id, id)).returning();
    if (correcting && deps.correction) {
      await recordCorrections(tx, { ordenId: id, userId: deps.correction.correctorId, before: order, after: patch });
    }
    return { before: order, updated: row };
  });

  const appointmentChanged =
    patch.appointmentAt !== undefined &&
    (patch.appointmentAt?.getTime() ?? null) !== (before.appointmentAt?.getTime() ?? null);

  // Only when it ACTUALLY differs: the edit form re-sends every field, so a
  // patch routinely carries the category it already has, and replanning on that
  // would cancel and re-book a healthy reminder on every unrelated save.
  //
  // `completedAt` gates it because a `service_due` only exists once the work is
  // finished — its interval is measured from that timestamp. An order still in
  // progress has no `service_due` to keep in sync.
  //
  // Truthiness on `completedAt`, matching the `updated.appointmentAt` check
  // below: `!== null` would also fire for an `undefined`, which is what a row
  // missing the column reads as.
  const serviceDueChanged = Boolean(
    patch.categoria !== undefined && patch.categoria !== before.categoria && updated.completedAt,
  );

  const replanAppointment = appointmentChanged && Boolean(updated.appointmentAt);

  if (appointmentChanged || serviceDueChanged) {
    const cancelForOrder = deps.cancelRemindersForOrder ?? cancelRemindersForOrder;
    if (appointmentChanged) await cancelForOrder(id, "appointment", deps);
    if (serviceDueChanged) await cancelForOrder(id, "service_due", deps);

    if (replanAppointment || serviceDueChanged) {
      // Fetched once for both branches, and not at all when neither replans
      // (an appointment cleared to `null` cancels and books nothing).
      const findCliente = deps.getClienteById ?? getClienteById;
      const clienteDetail = await findCliente(updated.clienteId, SYSTEM_SCOPE);
      if (clienteDetail) {
        if (replanAppointment) {
          await planAndScheduleReminders(updated, clienteDetail.cliente, "appointment", deps);
        }
        if (serviceDueChanged) {
          // `planReminders` drops any `scheduledFor <= now`, so a category
          // corrected long after completion cancels the stale reminder and
          // books nothing. That is the correct outcome, not a gap: the new
          // interval has already elapsed, and a reminder for it would be
          // firing late for work the customer had done a year ago.
          await planAndScheduleReminders(updated, clienteDetail.cliente, "service_due", deps);
        }
      }
    }
  }

  return updated;
}

export type TransitionOrdenServicioDeps = {
  /**
   * General-purpose extension seam kept from Phase 3: invoked AFTER the
   * status write (and after the reminder wiring below), with the updated row
   * and the from/to states. No-op by default — NOT the reminder wiring
   * mechanism itself (see the module-level comment on why reminders are
   * wired as first-class steps instead).
   */
  onTransitioned?: (order: OrdenServicio, from: OrderStatus, to: OrderStatus) => Promise<void> | void;
  /** The caller's `orderScope(user)`: an order outside it is "not found", never a 403. */
  scope: OrderScope;
  /** `can(user, "service-orders.assign")`: without it only `open -> in_progress` is allowed. */
  canAssign: boolean;
} & ReminderWiringDeps;

/**
 * R21 — validates the transition via transitions.ts, then persists status +
 * (on `-> done`) completedAt. R23 — `-> done` plans+persists+schedules a
 * `service_due` reminder; `-> cancelled` cancels every still-pending reminder
 * tied to this order (both AFTER the status write succeeds).
 */
export async function transitionOrder(
  id: string,
  to: OrderStatus,
  deps: TransitionOrdenServicioDeps,
): Promise<OrdenServicio> {
  const now = deps.now ?? (() => new Date());
  const database = deps.db ?? db;

  // Lock, read the status from the LOCKED row, validate and write in one transaction: a
  // concurrent done-vs-cancel (or a correction) waits on the lock, then fails the state
  // machine instead of both winning. `canWrite: () => true` because every status may
  // TRY a transition; `assertTransition` is the rule, and it has no edge out of a closed one.
  const { from, updated } = await database.transaction(async (tx) => {
    const { order } = await lockOrderForMutation(tx, id, { scope: deps.scope, canWrite: () => true });
    assertTransition(order.status, to);
    assertTransitionPermitted(deps.canAssign, order.status, to);
    const patch: Partial<OrdenServicio> = { status: to };
    if (to === "done") patch.completedAt = now();
    const [row] = await tx.update(ordenServicio).set(patch).where(eq(ordenServicio.id, id)).returning();
    // Sending a ready order back for rework reopens every part: the old marks describe work that is being redone,
    // and while they persisted nobody could mark again, so readiness could never recur.
    if (order.status === "ready_for_review" && to === "in_progress") {
      await tx.update(ordenTecnico).set({ parteListaAt: null }).where(eq(ordenTecnico.ordenId, id));
    }
    return { from: order.status, updated: row };
  });

  if (to === "done") {
    const findCliente = deps.getClienteById ?? getClienteById;
    const clienteDetail = await findCliente(updated.clienteId, SYSTEM_SCOPE);
    if (clienteDetail) {
      await planAndScheduleReminders(updated, clienteDetail.cliente, "service_due", deps);
    }
  } else if (to === "cancelled") {
    const cancelForOrder = deps.cancelRemindersForOrder ?? cancelRemindersForOrder;
    await cancelForOrder(id, undefined, deps);
  }

  await deps.onTransitioned?.(updated, from, to);

  return updated;
}
