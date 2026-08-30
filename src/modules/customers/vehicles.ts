/**
 * customers/vehicles.ts — sole owner of `vehiculo` reads/writes
 * (vehicles-one-to-many, C3, design.md D3 "one owner"). Pages, the picker,
 * and the API only ever see plain arrays (`Vehiculo[]`, `plates: string[]`)
 * built here or composed into `queries.ts` — never a raw query builder.
 */
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { db } from "@/shared/db/client";
import { cliente, vehiculo, type Vehiculo } from "@/shared/db/schema";
import { ClienteValidationError } from "./validation";

export type VehiculoInput = { id?: string; plate: string; make?: string; model?: string; year?: number };
export type VehiculoPlan = { inserts: VehiculoInput[]; updates: VehiculoInput[]; deactivate: string[] };

/**
 * Drizzle transaction handle — same `deps.database?: { transaction }` seam
 * as `account/service.ts`'s `TxLike`, but exposing the query builders (not
 * raw `execute`), since every write here goes through Drizzle, not
 * hand-written SQL (D5).
 */
export type TxLike = Pick<typeof db, "insert" | "update" | "select">;

/** D3 — the one active-vehicle filter every read path must apply. */
export function activeVehiculoFilter(): SQL {
  return isNull(vehiculo.deactivatedAt);
}

/**
 * D4 — correlated `array_agg` of an outer `cliente` row's active plates,
 * ordered by `created_at` then `id`. `created_at` alone is NOT insertion
 * order: it defaults to `now()`, the TRANSACTION timestamp, so every row of
 * one batch insert (`applyVehiculoPlan`'s multi-row `values()`) shares it and
 * their relative order is whatever the planner returns. `id` breaks the tie
 * — arbitrary but stable, which is what a rendered plate list needs.
 * Column names are hardcoded (not interpolated `Column`
 * objects) deliberately: when this fragment is embedded in a `.select({...})`
 * field map (as opposed to a `.where()` clause), Drizzle's own qualifier
 * elision drops the table prefix on interpolated columns — and `vehiculo`
 * has its own `id` column, so an unqualified `"id"` inside this subquery
 * resolves to `vehiculo.id`, not the intended outer `cliente.id`, silently
 * returning zero rows. Verified against the real DB, not assumed — see
 * apply-progress. `vehiculo`/`cliente` are static, developer-controlled
 * identifiers, not user input, so hardcoding them here is safe.
 */
export function platesSubquery(): SQL<string[]> {
  return sql<string[]>`(select coalesce(array_agg("vehiculo"."plate" order by "vehiculo"."created_at", "vehiculo"."id"), '{}')
    from "vehiculo" where "vehiculo"."cliente_id" = "cliente"."id" and "vehiculo"."deactivated_at" is null)`;
}

/**
 * D4 — R19's plate predicate: a `cliente` row matches when ANY of its ACTIVE
 * vehicles' plates matches. Correlated `EXISTS`, not a `LEFT JOIN`, so
 * `listClientes`/`countClientes` stay structurally identical.
 *
 * `match` is the caller's text comparison (`queries.ts`'s `unaccentIlike`),
 * passed in rather than imported: the accent-folding rule belongs with the
 * other searchable columns, while `vehiculo` stays owned by this module (D3
 * "one owner" — `vehiculo` is imported from `schema.ts` here and nowhere
 * else). Importing it the other way round would make `queries.ts` ↔
 * `vehicles.ts` circular.
 */
export function vehiculoPlateExists(
  pattern: string,
  match: (column: PgColumn, pattern: string) => SQL,
): SQL {
  return sql`exists (select 1 from ${vehiculo} where ${vehiculo.clienteId} = ${cliente.id} and ${activeVehiculoFilter()} and ${match(vehiculo.plate, pattern)})`;
}

/**
 * R16, restore — a customer's vehicles. Active-only by DEFAULT (mirrors
 * `account/queries.ts`'s `listUsers`); `includeInactive` is threaded into
 * `queryFn` rather than the caller swapping the whole query, so the default
 * is observable in a DB-free test. `getClienteById` opts in: the detail view
 * and `CustomerForm`'s restore action both need to see an inactive vehicle
 * to offer it back.
 */
export async function listVehiculosByCliente(
  clienteId: string,
  options: { includeInactive?: boolean } = {},
  queryFn: (includeInactive: boolean) => Promise<Vehiculo[]> = (includeInactive) =>
    db
      .select()
      .from(vehiculo)
      .where(
        includeInactive
          ? eq(vehiculo.clienteId, clienteId)
          : and(eq(vehiculo.clienteId, clienteId), activeVehiculoFilter()),
      ),
): Promise<Vehiculo[]> {
  return queryFn(options.includeInactive ?? false);
}

/**
 * D5 — pure reconcile. `existing` is the customer's WHOLE vehicle collection
 * — active AND inactive — so an id belonging to an already-deactivated
 * vehicle is recognized as this customer's own rather than rejected as
 * foreign (restore); `incoming` is the already-validated payload. Omitted
 * `incoming` leaves the collection completely untouched (R16); `[]`
 * deactivates every active vehicle. An element WITH `id` is an update,
 * WITHOUT `id` is an insert — plates are never the key (editable, not
 * unique). An `id` absent from `existing` (another customer's) throws rather
 * than silently inserting — a trust boundary, not a data-shape bug. Only
 * ACTIVE vehicles omitted from `incoming` are deactivated — an already-
 * inactive one omitted again is left alone, so its original
 * `deactivated_at` is never overwritten by an unrelated edit. An update
 * always restores (`applyVehiculoPlan` clears `deactivatedAt`), so naming an
 * inactive vehicle's id in `incoming` is how a client restores it. A
 * re-added plate with no id becomes a brand new row; this deliberately does
 * not resurrect a deactivated one by plate (ponytail: revive-on-match by
 * plate if history continuity is ever asked for — id-based restore above
 * already covers the explicit case).
 */
export function planVehiculoReconcile(existing: Vehiculo[], incoming: VehiculoInput[] | undefined): VehiculoPlan {
  if (incoming === undefined) {
    return { inserts: [], updates: [], deactivate: [] };
  }

  const existingIds = new Set(existing.map((v) => v.id));
  const keptIds = new Set<string>();
  const inserts: VehiculoInput[] = [];
  const updates: VehiculoInput[] = [];

  for (const item of incoming) {
    if (item.id === undefined) {
      inserts.push(item);
      continue;
    }
    if (!existingIds.has(item.id)) {
      throw new ClienteValidationError({ vehicles: `El vehículo ${item.id} no pertenece a este cliente` });
    }
    keptIds.add(item.id);
    updates.push(item);
  }

  const deactivate = existing
    .filter((v) => v.deactivatedAt === null && !keptIds.has(v.id))
    .map((v) => v.id);
  return { inserts, updates, deactivate };
}

/**
 * D5 — executes a plan inside `tx`; the transaction stays a dumb executor of
 * the pure plan above.
 *
 * Every statement is scoped to `clienteId`, including the two that already
 * carry a primary key. `planVehiculoReconcile` rejects a foreign id, but that
 * is a caller-side invariant — it only holds when the caller handed it the
 * right `existing` set. Ownership is the trust boundary this module's D5
 * docstring names, and a trust boundary enforced only by its callers is not
 * one; the extra predicate costs nothing and turns a cross-customer write into
 * zero affected rows.
 */
export async function applyVehiculoPlan(tx: TxLike, clienteId: string, plan: VehiculoPlan): Promise<void> {
  if (plan.inserts.length > 0) {
    await tx.insert(vehiculo).values(
      plan.inserts.map((v) => ({
        clienteId,
        plate: v.plate,
        make: v.make ?? null,
        model: v.model ?? null,
        year: v.year ?? null,
      })),
    );
  }

  for (const v of plan.updates) {
    // `deactivatedAt: null` unconditionally — an update is "this vehicle
    // exists and is active with these values", whether it was already active
    // (no-op here) or inactive (this is the restore, D5).
    await tx
      .update(vehiculo)
      .set({ plate: v.plate, make: v.make ?? null, model: v.model ?? null, year: v.year ?? null, deactivatedAt: null })
      .where(and(eq(vehiculo.clienteId, clienteId), eq(vehiculo.id, v.id!)));
  }

  if (plan.deactivate.length > 0) {
    await tx
      .update(vehiculo)
      .set({ deactivatedAt: new Date() })
      .where(and(eq(vehiculo.clienteId, clienteId), inArray(vehiculo.id, plan.deactivate)));
  }
}
