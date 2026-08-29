/**
 * customers/queries.ts — DB read model for `cliente` (R16, R18, R19).
 *
 * DI seam mirrors inventory-sync/job.ts's `hasActiveSyncRun`/`getLatestSyncRun`:
 * each exported read function takes an optional `queryFn` that fully replaces
 * the real DB call (defaulting to the actual drizzle query), so this module
 * is unit-testable with injected fakes and no live Postgres connection.
 */
import { count, desc, eq, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { db } from "@/shared/db/client";
import { cliente, ordenServicio, vehiculo, type Cliente, type OrdenServicio, type Vehiculo } from "@/shared/db/schema";
import { activeVehiculoFilter, listVehiculosByCliente, platesSubquery } from "./vehicles";

export const DEFAULT_PAGE_SIZE = 10;

export type ClienteFilters = { search?: string };

/**
 * `vehiclePlate` is kept for now alongside `plates` — dropping it would break
 * `customers/page.tsx` and `CustomerPicker.tsx`, both slice 3 scope
 * (expand/contract, design.md). It's removed when `cliente`'s inline vehicle
 * columns are (migration 0014, slice 3).
 */
export type ClienteListItem = Pick<Cliente, "id" | "name" | "phone" | "email" | "vehiclePlate" | "createdAt"> & {
  /** R19/D4 — this customer's active vehicle plates, replacing the single `vehiclePlate` column as the source of truth. */
  plates: string[];
};

export type ClienteDetail = { cliente: Cliente; orders: OrdenServicio[]; vehicles: Vehiculo[] };

/**
 * `ilike` folds case but NOT accents, so 'María GONZÁLEZ' ilike '%maria%' is
 * false. Wrapping BOTH sides in `unaccent()` (extension enabled by migration
 * 0012) makes the fold symmetric: an unaccented term matches an accented row
 * and vice versa.
 *
 * `unaccent()` is STABLE, not IMMUTABLE, so it can never back an expression
 * index — see design.md's "Migration / Rollout". Correct at 364 rows; a
 * future `pg_trgm` upgrade must account for it.
 */
function unaccentIlike(column: PgColumn, pattern: string): SQL {
  return sql`unaccent(${column}) ilike unaccent(${pattern})`;
}

/**
 * D4 — plate match as an EXISTS over the customer's active vehicle
 * collection (not a single-column comparison): a customer matches if ANY one
 * active vehicle's plate matches. `unaccentIlike` is reused verbatim (PR
 * #44), now against `vehiculo.plate`. `activeVehiculoFilter()` (D3) supplies
 * the `deactivated_at is null` clause — dropping it is caught by the
 * "active vehicles only" unit test below, no database needed.
 */
function vehiculoPlateExists(pattern: string): SQL {
  return sql`exists (select 1 from ${vehiculo} where ${vehiculo.clienteId} = ${cliente.id} and ${activeVehiculoFilter()} and ${unaccentIlike(vehiculo.plate, pattern)})`;
}

/** Pure — R19's "partial, case- and accent-insensitive match against name, phone, or any active vehicle plate". */
export function buildClienteSearchWhere(search?: string) {
  const term = search?.trim();
  if (!term) return undefined;
  const pattern = `%${term}%`;
  return or(unaccentIlike(cliente.name, pattern), unaccentIlike(cliente.phone, pattern), vehiculoPlateExists(pattern));
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
        plates: platesSubquery(),
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
    const vehicles = await listVehiculosByCliente(id);
    return { cliente: clienteRow, orders, vehicles };
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
