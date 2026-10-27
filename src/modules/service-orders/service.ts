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
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { esperaMotivoEnum, ordenServicio, ordenTecnico, reminder, vehiculo, type Cliente, type OrdenServicio } from "@/shared/db/schema";
import { getClienteById } from "@/modules/customers/queries";
import { ClienteDeactivatedError } from "@/modules/customers/service";
import { cancelRemindersForOrder, scheduleReminder } from "@/modules/reminders/job";
import { planReminders, type ReminderType } from "@/modules/reminders/schedule";
import { enqueuePortalSync, type PortalSyncDeps } from "@/modules/portal-sync/enqueue";
import { isServiceCategory, type ServiceCategory } from "./categories";
import type { IntakeValues } from "./intake";
import type { Role } from "@/modules/auth/roles";
import { canEditOrderFields } from "./edit-policy";
import { assertActiveTecnicos } from "./assignments";
import { SYSTEM_SCOPE, type OrderScope } from "./scope";
import { lockOrderForMutation, recordCorrections, type CorrectionGrant, type Tx } from "./order-lock";
import { recordStatus, setStatus } from "./set-status";
import { assertTransition, assertTransitionPermitted, AUTOMATIC_TARGETS, OrderTransitionError, type OrderStatus } from "./transitions";

export type EsperaMotivo = (typeof esperaMotivoEnum.enumValues)[number];

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
 * and came back a 500 (`22P02` when bogus, and the `orden_vehiculo_categoria_required` CHECK, `23514`, when omitted on a Recibida order).
 */
export class InvalidCategoriaError extends Error {
  constructor(readonly errors: { categoria: string }) {
    super("Invalid categoria");
  }
}

/** Thrown when a create asks for an initial status other than Agendada or Recibida. */
export class InvalidInitialStatusError extends Error {
  constructor(readonly errors: { status: string }) {
    super("Invalid initial status");
  }
}

/** An Agendada order always carries its date: it is what the appointment reminder and the board hang on. */
export class AppointmentRequiredError extends Error {
  constructor(readonly errors: { appointmentAt: string }) {
    super("Appointment required");
  }
}

/** The on-hold reason contract broken: required exactly when the target is `on_hold`. The message is Spanish UI copy. */
export class EsperaMotivoError extends Error {}

/** Receiving a booked order that still lacks its vehicle or category. The message is Spanish UI copy. */
export class OrderIncompleteError extends Error {
  constructor() {
    super("Completá el vehículo y la categoría antes de recibir la orden");
  }
}

/** `expectedStatus` of a transition no longer matches the locked row: the caller acted on a stale screen. The message is Spanish UI copy. */
export class StaleOrderStatusError extends Error {
  constructor() {
    super("La orden cambió mientras la mirabas. Actualizá la agenda.");
  }
}

export type CreateOrdenServicioInput = {
  /** Agendada (`booked`) or Recibida (`open`, the default); nothing else is a valid start. */
  status?: "booked" | "open";
  clienteId: string;
  /** Required for Recibida; an Agendada order may omit it and have it set later (0034). Checked either way when given. */
  vehiculoId?: string | null;
  /** Same rule as `vehiculoId`. */
  categoria?: ServiceCategory | null;
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

export type CreateOrdenServicioDeps = ReminderWiringDeps & PortalSyncDeps;

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
  const status = input.status ?? "open";
  if (status !== "booked" && status !== "open") {
    throw new InvalidInitialStatusError({ status: "La orden solo puede crearse como Agendada o Recibida" });
  }
  if (status === "booked" && !input.appointmentAt) {
    throw new AppointmentRequiredError({ appointmentAt: "Indicá la fecha y hora de la cita" });
  }

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
  //
  // An Agendada order may leave the vehicle and the category out (completed later while it is
  // booked); one it does name is checked exactly like a Recibida order's, which needs both.
  const mayOmit = status === "booked";
  const ownsVehicle = clienteDetail.vehicles?.some((v) => v.id === input.vehiculoId && v.deactivatedAt === null);
  if (!(mayOmit && input.vehiculoId == null) && !ownsVehicle) {
    throw new InvalidVehiculoError({ vehiculoId: "Seleccioná un vehículo válido de este cliente" });
  }

  if (!(mayOmit && input.categoria == null) && !isServiceCategory(input.categoria)) {
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
        vehiculoId: input.vehiculoId ?? null,
        categoria: input.categoria ?? null,
        status,
        description: input.description ?? null,
        observaciones: input.observaciones ?? null,
        appointmentAt: input.appointmentAt ?? null,
        kilometraje: input.kilometraje ?? null,
        nivelCombustible: input.nivelCombustible ?? null,
        bateriaPct: input.bateriaPct ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    await recordStatus(tx, { ordenId: inserted.id, from: null, to: status, actor: input.createdBy ?? null });

    if (tecnicoIds.length > 0) {
      await tx
        .insert(ordenTecnico)
        .values(tecnicoIds.map((tecnicoId) => ({ ordenId: inserted.id, tecnicoId, assignedBy: input.createdBy! })));
      // A walk-in with a technician starts diagnosing; an Agendada order waits to be received.
      if (status === "open") return setStatus(tx, inserted, "diagnosing", input.createdBy!);
    }

    return inserted;
  });

  // Before the reminder wiring: a failure there must not lose the portal sync.
  await (deps.enqueuePortalSync ?? enqueuePortalSync)(orden.clienteId);

  if (orden.appointmentAt) {
    await planAndScheduleReminders(orden, clienteDetail.cliente, "appointment", deps);
  }

  return orden;
}

export type UpdateOrdenServicioPatch = {
  description?: string | null;
  appointmentAt?: Date | null;
  categoria?: ServiceCategory;
  /** Only while the order is `booked` (checked under the lock): from `open` on, the vehicle is frozen. */
  vehiculoId?: string;
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
} & ReminderWiringDeps &
  PortalSyncDeps;

/** The vehicle can be set only while the order is `booked`, and only to an active one of the order's own customer. */
async function assertVehicleSettable(tx: Tx, order: Pick<OrdenServicio, "clienteId" | "status">, vehiculoId: string): Promise<void> {
  if (order.status !== "booked") {
    throw new InvalidVehiculoError({ vehiculoId: "El vehículo solo se puede cambiar mientras la orden está Agendada" });
  }
  const [owned] = await tx
    .select({ id: vehiculo.id })
    .from(vehiculo)
    .where(and(eq(vehiculo.id, vehiculoId), eq(vehiculo.clienteId, order.clienteId), isNull(vehiculo.deactivatedAt)));
  if (!owned) throw new InvalidVehiculoError({ vehiculoId: "Seleccioná un vehículo válido de este cliente" });
}

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
    if (patch.vehiculoId !== undefined) await assertVehicleSettable(tx, order, patch.vehiculoId);
    if (order.status === "booked" && patch.appointmentAt === null) {
      throw new AppointmentRequiredError({ appointmentAt: "Una orden agendada necesita su fecha y hora" });
    }
    const [row] = await tx.update(ordenServicio).set(patch).where(eq(ordenServicio.id, id)).returning();
    if (correcting && deps.correction) {
      await recordCorrections(tx, { ordenId: id, userId: deps.correction.correctorId, before: order, after: patch });
    }
    return { before: order, updated: row };
  });

  // Before the reminder wiring: a failure there must not lose the portal sync.
  await (deps.enqueuePortalSync ?? enqueuePortalSync)(updated.clienteId);

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
  /** `can(user, "service-orders.assign")`: without it no manual transition is allowed. */
  canAssign: boolean;
  /** The user whose request this is: recorded on every history row the transition writes. */
  actorId: string;
  /** Required exactly when `to` is `on_hold`; refused with any other target. Unchecked at the type level: it comes from a body. */
  esperaMotivo?: EsperaMotivo | null;
  /** Optional guard: the status the caller saw. Compared with the LOCKED row before anything is written; absent = no check. */
  expectedStatus?: OrderStatus;
} & ReminderWiringDeps &
  PortalSyncDeps;

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

  const esperaMotivo = deps.esperaMotivo ?? null;

  // Lock, read the status from the LOCKED row, validate and write in one transaction: a
  // concurrent done-vs-cancel (or a correction) waits on the lock, then fails the state
  // machine instead of both winning. `canWrite: () => true` because every status may
  // TRY a transition; `assertTransition` is the rule, and it has no edge out of a closed one.
  const { from, updated } = await database.transaction(async (tx) => {
    const { order } = await lockOrderForMutation(tx, id, { scope: deps.scope, canWrite: () => true });
    if (deps.expectedStatus !== undefined && deps.expectedStatus !== order.status) throw new StaleOrderStatusError();
    // After the lock, so an order that does not exist (or is out of scope) answers 404 before any 400 about the body.
    if (to === "on_hold" ? !esperaMotivoEnum.enumValues.includes(esperaMotivo as EsperaMotivo) : esperaMotivo !== null) {
      throw new EsperaMotivoError(
        to === "on_hold" ? "Indicá el motivo de la espera: repuesto o aprobación del cliente" : "Solo una orden en espera lleva motivo",
      );
    }
    // Automatic targets are written by their own paths (assignment, readiness).
    if (AUTOMATIC_TARGETS.has(to)) throw new OrderTransitionError(order.status, to);
    assertTransition(order.status, to);
    assertTransitionPermitted(deps.canAssign, order.status, to);
    // Refused here so the CHECK `orden_vehiculo_categoria_required` (0034) never surfaces as a 500.
    if (order.status === "booked" && to === "open" && (order.vehiculoId === null || order.categoria === null)) {
      throw new OrderIncompleteError();
    }
    let row = await setStatus(tx, order, to, deps.actorId, {
      esperaMotivo: esperaMotivo ?? undefined,
      completedAt: to === "done" ? now() : undefined,
    });
    // Receiving an order that already has a technician continues straight to diagnosing.
    if (order.status === "booked" && to === "open") {
      const assigned = await tx.select({ id: ordenTecnico.tecnicoId }).from(ordenTecnico).where(eq(ordenTecnico.ordenId, id));
      if (assigned.length > 0) row = await setStatus(tx, row, "diagnosing", deps.actorId);
    }
    // Sending a ready order back for rework reopens every part: the old marks describe work that is being redone,
    // and while they persisted nobody could mark again, so readiness could never recur.
    if (order.status === "ready_for_review" && to === "in_progress") {
      await tx.update(ordenTecnico).set({ parteListaAt: null }).where(eq(ordenTecnico.ordenId, id));
    }
    return { from: order.status, updated: row };
  });

  // Before the reminder wiring: a failure there must not lose the portal sync.
  await (deps.enqueuePortalSync ?? enqueuePortalSync)(updated.clienteId);

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
