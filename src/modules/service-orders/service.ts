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
import { ordenServicio, ordenServicioItem, reminder, type Cliente, type OrdenServicio } from "@/shared/db/schema";
import { getClienteById } from "@/modules/customers/queries";
import { cancelRemindersForOrder, scheduleReminder } from "@/modules/reminders/job";
import { planReminders, type ReminderType } from "@/modules/reminders/schedule";
import type { ServiceCategory } from "./categories";
import { getOrdenServicioById } from "./queries";
import { assertTransition, type OrderStatus } from "./transitions";

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

export type CreateOrdenServicioItemInput = {
  productoId?: string | null;
  productName: string;
  unitPrice?: number | null;
  quantity?: number;
};

export type CreateOrdenServicioInput = {
  clienteId: string;
  vehiculoId: string;
  categoria: ServiceCategory;
  description?: string | null;
  appointmentAt?: Date | null;
  createdBy?: string | null;
  items?: CreateOrdenServicioItemInput[];
};

export type NormalizedOrderItem = {
  productoId?: string | null;
  productName: string;
  unitPrice?: number | null;
  quantity: number;
};

/**
 * R20 — duplicate-`producto` policy: MERGE quantities (chosen over
 * append-as-a-second-line). Re-adding the same part to an order just bumps
 * the existing line's quantity instead of producing two rows for the same
 * part on one order — simpler for the parts-used history to read, and
 * matches how a cart/line-item UI conventionally behaves when the same SKU
 * is added twice. Items with NO `productoId` (custom/off-catalog parts, e.g.
 * shop labor entered as a free-text line) are never merged with each other
 * since there is no stable dedupe key for them — silently combining two
 * differently-intentioned custom lines would be surprising, not helpful.
 */
export function normalizeOrderItems(items: CreateOrdenServicioItemInput[]): NormalizedOrderItem[] {
  const merged: NormalizedOrderItem[] = [];
  const indexByProductoId = new Map<string, number>();

  for (const item of items) {
    const quantity = item.quantity ?? 1;

    if (item.productoId) {
      const existingIndex = indexByProductoId.get(item.productoId);
      if (existingIndex !== undefined) {
        merged[existingIndex] = { ...merged[existingIndex], quantity: merged[existingIndex].quantity + quantity };
        continue;
      }
      indexByProductoId.set(item.productoId, merged.length);
    }

    merged.push({ ...item, quantity });
  }

  return merged;
}

export type CreateOrdenServicioDeps = ReminderWiringDeps;

/**
 * R20 — creates the order + its line items in ONE transaction (all-or-
 * nothing: a mid-write failure leaves no partial order). Rejects unknown
 * `clienteId` BEFORE opening the transaction. Never writes to `producto`.
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
  const clienteDetail = await findCliente(input.clienteId);
  if (!clienteDetail) {
    throw new UnknownClienteError(input.clienteId);
  }

  // C4 — ownership check reuses clienteDetail.vehicles, already fetched above
  // for the unknown-cliente check: zero extra queries. Only an ACTIVE vehicle
  // of THIS customer is accepted (design.md's deliberate tightening).
  const ownsVehicle = clienteDetail.vehicles?.some((v) => v.id === input.vehiculoId && v.deactivatedAt === null);
  if (!ownsVehicle) {
    throw new InvalidVehiculoError({ vehiculoId: "Seleccioná un vehículo válido de este cliente" });
  }

  const items = normalizeOrderItems(input.items ?? []);
  const database = deps.db ?? db;

  const orden = await database.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(ordenServicio)
      .values({
        clienteId: input.clienteId,
        vehiculoId: input.vehiculoId,
        categoria: input.categoria,
        description: input.description ?? null,
        appointmentAt: input.appointmentAt ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();

    if (items.length > 0) {
      await tx.insert(ordenServicioItem).values(
        items.map((item) => ({
          ordenId: inserted.id,
          productoId: item.productoId ?? null,
          productName: item.productName,
          unitPrice: item.unitPrice ?? null,
          quantity: item.quantity,
        })),
      );
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
};

export type UpdateOrdenServicioDeps = {
  getById?: typeof getOrdenServicioById;
} & ReminderWiringDeps;

/**
 * Plain field edits (description/appointmentAt) — status changes go through
 * transitionOrder(). R23 — when `appointmentAt` is part of the patch and its
 * value actually changes (including being cleared to `null`), any pending
 * `appointment` reminder for this order is cancelled first, then a new one
 * is planned+scheduled if the new value is still set — "the old and new
 * reminders MUST NOT both fire" (spec R23 scenario).
 */
export async function updateOrder(
  id: string,
  patch: UpdateOrdenServicioPatch,
  deps: UpdateOrdenServicioDeps = {},
): Promise<OrdenServicio> {
  const getById = deps.getById ?? getOrdenServicioById;
  const current = await getById(id);
  if (!current) {
    throw new OrdenServicioNotFoundError(id);
  }

  const database = deps.db ?? db;
  const [updated] = await database.update(ordenServicio).set(patch).where(eq(ordenServicio.id, id)).returning();

  const appointmentChanged =
    patch.appointmentAt !== undefined &&
    (patch.appointmentAt?.getTime() ?? null) !== (current.orden.appointmentAt?.getTime() ?? null);

  if (appointmentChanged) {
    const cancelForOrder = deps.cancelRemindersForOrder ?? cancelRemindersForOrder;
    await cancelForOrder(id, "appointment", deps);

    if (updated.appointmentAt) {
      const findCliente = deps.getClienteById ?? getClienteById;
      const clienteDetail = await findCliente(updated.clienteId);
      if (clienteDetail) {
        await planAndScheduleReminders(updated, clienteDetail.cliente, "appointment", deps);
      }
    }
  }

  return updated;
}

export type TransitionOrdenServicioDeps = {
  getById?: typeof getOrdenServicioById;
  /**
   * General-purpose extension seam kept from Phase 3: invoked AFTER the
   * status write (and after the reminder wiring below), with the updated row
   * and the from/to states. No-op by default — NOT the reminder wiring
   * mechanism itself (see the module-level comment on why reminders are
   * wired as first-class steps instead).
   */
  onTransitioned?: (order: OrdenServicio, from: OrderStatus, to: OrderStatus) => Promise<void> | void;
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
  deps: TransitionOrdenServicioDeps = {},
): Promise<OrdenServicio> {
  const getById = deps.getById ?? getOrdenServicioById;
  const current = await getById(id);
  if (!current) {
    throw new OrdenServicioNotFoundError(id);
  }

  const from = current.orden.status;
  assertTransition(from, to);

  const now = deps.now ?? (() => new Date());
  const patch: Partial<OrdenServicio> = { status: to };
  if (to === "done") {
    patch.completedAt = now();
  }

  const database = deps.db ?? db;
  const [updated] = await database.update(ordenServicio).set(patch).where(eq(ordenServicio.id, id)).returning();

  if (to === "done") {
    const findCliente = deps.getClienteById ?? getClienteById;
    const clienteDetail = await findCliente(updated.clienteId);
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
