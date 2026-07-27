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
 */
import { eq } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { ordenServicio, ordenServicioItem, type OrdenServicio } from "@/shared/db/schema";
import { getClienteById } from "@/modules/customers/queries";
import { getOrdenServicioById } from "./queries";
import { assertTransition, type OrderStatus } from "./transitions";

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

export type CreateOrdenServicioItemInput = {
  productoId?: string | null;
  productName: string;
  unitPrice?: number | null;
  quantity?: number;
};

export type CreateOrdenServicioInput = {
  clienteId: string;
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

export type CreateOrdenServicioDeps = {
  getClienteById?: typeof getClienteById;
  db?: typeof db;
};

/**
 * R20 — creates the order + its line items in ONE transaction (all-or-
 * nothing: a mid-write failure leaves no partial order). Rejects unknown
 * `clienteId` BEFORE opening the transaction. Never writes to `producto`.
 */
export async function createOrder(
  input: CreateOrdenServicioInput,
  deps: CreateOrdenServicioDeps = {},
): Promise<OrdenServicio> {
  const findCliente = deps.getClienteById ?? getClienteById;
  const cliente = await findCliente(input.clienteId);
  if (!cliente) {
    throw new UnknownClienteError(input.clienteId);
  }

  const items = normalizeOrderItems(input.items ?? []);
  const database = deps.db ?? db;

  return database.transaction(async (tx) => {
    const [orden] = await tx
      .insert(ordenServicio)
      .values({
        clienteId: input.clienteId,
        description: input.description ?? null,
        appointmentAt: input.appointmentAt ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();

    if (items.length > 0) {
      await tx.insert(ordenServicioItem).values(
        items.map((item) => ({
          ordenId: orden.id,
          productoId: item.productoId ?? null,
          productName: item.productName,
          unitPrice: item.unitPrice ?? null,
          quantity: item.quantity,
        })),
      );
    }

    return orden;
  });
}

export type UpdateOrdenServicioPatch = {
  description?: string | null;
  appointmentAt?: Date | null;
};

export type UpdateOrdenServicioDeps = {
  getById?: typeof getOrdenServicioById;
  db?: typeof db;
};

/** Plain field edits (description/appointmentAt) — status changes go through transitionOrder(). */
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
  return updated;
}

export type TransitionOrdenServicioDeps = {
  getById?: typeof getOrdenServicioById;
  db?: typeof db;
  now?: () => Date;
  /**
   * Phase 4 seam: invoked AFTER the status write succeeds, with the updated
   * row and the from/to states. No-op by default. This PR does NOT call any
   * reminder code — the `reminders` module doesn't exist until Phase 4, which
   * wires its real implementation in here (schedule `service_due` on `->
   * done`, cancel pending reminders on `-> cancelled`) without touching this
   * function's transition logic again.
   */
  onTransitioned?: (order: OrdenServicio, from: OrderStatus, to: OrderStatus) => Promise<void> | void;
};

/** R21 — validates the transition via transitions.ts, then persists status + (on `-> done`) completedAt. */
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

  await deps.onTransitioned?.(updated, from, to);

  return updated;
}
