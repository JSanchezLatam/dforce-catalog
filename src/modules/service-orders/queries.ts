/**
 * service-orders/queries.ts — DB read model for `orden_servicio` (R20, R21).
 *
 * DI seam mirrors customers/queries.ts / inventory-sync/job.ts's queryFn
 * pattern: each exported read function takes an optional `queryFn` that
 * fully replaces the real DB call (defaulting to the actual drizzle query),
 * so this module is unit-testable with injected fakes and no live Postgres
 * connection.
 */
import { count, desc, eq } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { ordenServicio, ordenServicioItem, type OrdenServicio, type OrdenServicioItem } from "@/shared/db/schema";
import type { OrderStatus } from "./transitions";

export const DEFAULT_PAGE_SIZE = 10;

export type OrdenServicioFilters = { status?: OrderStatus };

export type OrdenServicioDetail = { orden: OrdenServicio; items: OrdenServicioItem[] };

/** Pure — R21's status-filter predicate for the list/count queries. */
export function buildOrdenServicioWhere(filters: OrdenServicioFilters) {
  return filters.status ? eq(ordenServicio.status, filters.status) : undefined;
}

/** R21 — paginated + status-filtered service-order list, newest first. */
export async function listOrdenesServicio(
  filters: OrdenServicioFilters,
  window: { offset: number; limit: number },
  queryFn: () => Promise<OrdenServicio[]> = () =>
    db
      .select()
      .from(ordenServicio)
      .where(buildOrdenServicioWhere(filters))
      .orderBy(desc(ordenServicio.createdAt))
      .limit(window.limit)
      .offset(window.offset),
): Promise<OrdenServicio[]> {
  return queryFn();
}

/** R21 — total count for the same filter, for pagination math. */
export async function countOrdenesServicio(
  filters: OrdenServicioFilters,
  queryFn: () => Promise<number> = async () => {
    const rows = await db.select({ value: count() }).from(ordenServicio).where(buildOrdenServicioWhere(filters));
    return rows[0]?.value ?? 0;
  },
): Promise<number> {
  return queryFn();
}

/** C4 — one vehicle's service-order history, most-recent first (`orden_vehiculo_created_idx`). */
export async function listOrdenesByVehiculo(
  vehiculoId: string,
  queryFn: () => Promise<OrdenServicio[]> = () =>
    db.select().from(ordenServicio).where(eq(ordenServicio.vehiculoId, vehiculoId)).orderBy(desc(ordenServicio.createdAt)),
): Promise<OrdenServicio[]> {
  return queryFn();
}

/** R20 — service-order detail + its line items. */
export async function getOrdenServicioById(
  id: string,
  queryFn: () => Promise<OrdenServicioDetail | null> = async () => {
    const rows = await db.select().from(ordenServicio).where(eq(ordenServicio.id, id)).limit(1);
    const orden = rows[0];
    if (!orden) return null;
    const items = await db.select().from(ordenServicioItem).where(eq(ordenServicioItem.ordenId, id));
    return { orden, items };
  },
): Promise<OrdenServicioDetail | null> {
  return queryFn();
}
