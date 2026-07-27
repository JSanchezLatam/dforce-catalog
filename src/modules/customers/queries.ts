/**
 * customers/queries.ts — DB read model for `cliente` (R16, R18, R19).
 *
 * DI seam mirrors inventory-sync/job.ts's `hasActiveSyncRun`/`getLatestSyncRun`:
 * each exported read function takes an optional `queryFn` that fully replaces
 * the real DB call (defaulting to the actual drizzle query), so this module
 * is unit-testable with injected fakes and no live Postgres connection.
 */
import { count, desc, eq, ilike, or } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { cliente, ordenServicio, type Cliente, type OrdenServicio } from "@/shared/db/schema";

export const DEFAULT_PAGE_SIZE = 10;

export type ClienteFilters = { search?: string };

export type ClienteListItem = Pick<Cliente, "id" | "name" | "phone" | "email" | "vehiclePlate" | "createdAt">;

export type ClienteDetail = { cliente: Cliente; orders: OrdenServicio[] };

/** Pure — R19's "partial, case-insensitive match against name, phone, or vehicle plate". */
export function buildClienteSearchWhere(search?: string) {
  const term = search?.trim();
  if (!term) return undefined;
  const pattern = `%${term}%`;
  return or(ilike(cliente.name, pattern), ilike(cliente.phone, pattern), ilike(cliente.vehiclePlate, pattern));
}

/** R19 — paginated + searched customer list, newest first. */
export async function listClientes(
  filters: ClienteFilters,
  window: { offset: number; limit: number },
  queryFn: () => Promise<ClienteListItem[]> = () =>
    db
      .select({
        id: cliente.id,
        name: cliente.name,
        phone: cliente.phone,
        email: cliente.email,
        vehiclePlate: cliente.vehiclePlate,
        createdAt: cliente.createdAt,
      })
      .from(cliente)
      .where(buildClienteSearchWhere(filters.search))
      .orderBy(desc(cliente.createdAt))
      .limit(window.limit)
      .offset(window.offset),
): Promise<ClienteListItem[]> {
  return queryFn();
}

/** R19 — total count for the same filter, for pagination math. */
export async function countClientes(
  filters: ClienteFilters,
  queryFn: () => Promise<number> = async () => {
    const rows = await db.select({ value: count() }).from(cliente).where(buildClienteSearchWhere(filters.search));
    return rows[0]?.value ?? 0;
  },
): Promise<number> {
  return queryFn();
}

/** R16 — customer detail + its service-order history, most-recent first. */
export async function getClienteById(
  id: string,
  queryFn: () => Promise<ClienteDetail | null> = async () => {
    const rows = await db.select().from(cliente).where(eq(cliente.id, id)).limit(1);
    const clienteRow = rows[0];
    if (!clienteRow) return null;
    const orders = await db
      .select()
      .from(ordenServicio)
      .where(eq(ordenServicio.clienteId, id))
      .orderBy(desc(ordenServicio.createdAt));
    return { cliente: clienteRow, orders };
  },
): Promise<ClienteDetail | null> {
  return queryFn();
}

/** R18 — duplicate-phone lookup; used by service.ts before create/update. */
export async function findClienteByPhone(
  phone: string,
  queryFn: () => Promise<Cliente[]> = () => db.select().from(cliente).where(eq(cliente.phone, phone)).limit(1),
): Promise<Cliente | null> {
  const rows = await queryFn();
  return rows[0] ?? null;
}
