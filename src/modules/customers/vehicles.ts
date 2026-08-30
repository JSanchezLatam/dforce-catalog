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

/**
 * `deactivated` is the activation state the CALLER asks for, and it is
 * tri-state on purpose: omitted means "leave this vehicle's activation state
 * exactly as it is". Without that default, `getClienteById` returning
 * inactive vehicles (needed for restore) plus an update that clears
 * `deactivated_at` would make the most obvious client possible — GET the
 * detail, PATCH the collection straight back — silently resurrect every soft
 * delete. Restore (`false`) has to be asked for, not inferred from a row
 * being included.
 */
/**
 * `deleted` is the OTHER removal, and it is deliberately not a second value of
 * `deactivated`. Deactivate means "the car is no longer with this customer" —
 * the row survives because its service history must. Delete means "this row
 * should never have existed" — a typo'd plate, a duplicate — and takes the row
 * with it. Only an element WITH an `id` can be deleted; there is nothing to
 * remove for one the server has never seen.
 */
export type VehiculoInput = {
  id?: string;
  plate: string;
  make?: string;
  model?: string;
  year?: number;
  deactivated?: boolean;
  deleted?: boolean;
};
export type VehiculoPlan = {
  inserts: VehiculoInput[];
  updates: VehiculoInput[];
  deactivate: string[];
  /** Ids to remove outright — the fourth outcome, disjoint from all three above. */
  delete: string[];
};

/**
 * Drizzle transaction handle — same `deps.database?: { transaction }` seam
 * as `account/service.ts`'s `TxLike`, but exposing the query builders (not
 * raw `execute`), since every write here goes through Drizzle, not
 * hand-written SQL (D5).
 */
export type TxLike = Pick<typeof db, "insert" | "update" | "delete" | "select">;

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
      )
      // Same `(created_at, id)` tuple `platesSubquery` uses, for the same
      // reason and with the same caveat: this buys STABILITY, not insertion
      // order. A batch insert shares one `created_at`, so `id` — a random
      // UUID — breaks the tie: arbitrary, but the same on every read.
      //
      // Without it this is a bare SELECT with no guaranteed order at all, and
      // `applyVehiculoPlan` UPDATEs every active vehicle on every save, which
      // writes a new tuple version that commonly lands at the end of the heap.
      // The rows would then reorder after an edit — and `CustomerForm` labels
      // them positionally (`Vehículo 1`), which is both the screen-reader name
      // and the test handle, so "Vehículo 1" would silently become a different
      // car. Ordering here also keeps the detail list and the joined
      // `Vehículos` column agreeing with each other.
      //
      // Deliberately UNTESTED, and that is the honest state: an e2e case was
      // written for it and deleted, because it passed with AND without this
      // clause. On a three-row table Postgres does not move the updated tuple
      // observably, so the failure mode is real in principle and not
      // reproducible at test scale. A test that cannot fail for its stated
      // reason is worse than none. This clause is one line of insurance
      // against depending on heap order at all — not a claim that a test
      // guards it.
      .orderBy(vehiculo.createdAt, vehiculo.id),
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
 * `deactivated_at` is never overwritten by an unrelated edit. Restore is
 * `deactivated: false` on the incoming element — naming an inactive
 * vehicle's id is NOT enough, or resending an unchanged collection would
 * reactivate every soft-deleted row in it (see `VehiculoInput`). A
 * An element carrying `deleted: true` is the FOURTH outcome — the row is
 * removed outright, never updated and never deactivated on the way out. A
 * re-added plate with no id becomes a brand new row; this deliberately does
 * not resurrect a deactivated one by plate (ponytail: revive-on-match by
 * plate if history continuity is ever asked for — id-based restore above
 * already covers the explicit case).
 */
export function planVehiculoReconcile(existing: Vehiculo[], incoming: VehiculoInput[] | undefined): VehiculoPlan {
  if (incoming === undefined) {
    return { inserts: [], updates: [], deactivate: [], delete: [] };
  }

  const existingIds = new Set(existing.map((v) => v.id));
  const keptIds = new Set<string>();
  const deactivateAsked = new Set<string>();
  const inserts: VehiculoInput[] = [];
  const updates: VehiculoInput[] = [];
  const deletions: string[] = [];

  for (const item of incoming) {
    if (item.id === undefined) {
      // A row the server has never seen has nothing to delete. Inserting it
      // because it lacks an id would create exactly the row the payload asked
      // to remove, so this element is simply nothing.
      if (item.deleted !== true) inserts.push(item);
      continue;
    }
    if (!existingIds.has(item.id)) {
      throw new ClienteValidationError({ vehicles: `El vehículo ${item.id} no pertenece a este cliente` });
    }
    if (item.deleted === true) {
      // Kept, so the "omitted means deactivate" rule below skips it: a row on
      // its way out must not also be soft-deleted. It is not an update either
      // — the columns are about to stop existing.
      keptIds.add(item.id);
      deletions.push(item.id);
      continue;
    }
    keptIds.add(item.id);
    if (item.deactivated === true) deactivateAsked.add(item.id);
    updates.push(item);
  }

  // Two ways in, one filter: omitted from `incoming` (the original mechanism)
  // or included with `deactivated: true` (a round-tripped payload saying "this
  // one is still deactivated"). Either way only ACTIVE rows are touched, so an
  // already-inactive vehicle never has its original `deactivated_at`
  // overwritten by an unrelated edit.
  const deactivate = existing
    .filter((v) => v.deactivatedAt === null && (!keptIds.has(v.id) || deactivateAsked.has(v.id)))
    .map((v) => v.id);
  return { inserts, updates, deactivate, delete: deletions };
}

/**
 * D5 — executes a plan inside `tx`; the transaction stays a dumb executor of
 * the pure plan above.
 *
 * Every statement is scoped to `clienteId`, including the three that already
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
    // `deactivated_at` is in the SET only when the payload asked for the row
    // to be active — that clear IS the restore (D5). Omitting the column
    // otherwise is what keeps a resent, unchanged collection a no-op; the
    // `true` case is handled by `plan.deactivate` below, which never
    // re-stamps a row that is already inactive.
    await tx
      .update(vehiculo)
      .set({
        plate: v.plate,
        make: v.make ?? null,
        model: v.model ?? null,
        year: v.year ?? null,
        ...(v.deactivated === false ? { deactivatedAt: null } : {}),
      })
      .where(and(eq(vehiculo.clienteId, clienteId), eq(vehiculo.id, v.id!)));
  }

  if (plan.deactivate.length > 0) {
    await tx
      .update(vehiculo)
      .set({ deactivatedAt: new Date() })
      .where(and(eq(vehiculo.clienteId, clienteId), inArray(vehiculo.id, plan.deactivate)));
  }

  if (plan.delete.length > 0) {
    // SEAM — the referential-integrity check goes HERE, immediately above this
    // statement, when `orden_servicio` gains its `vehiculo_id` FK (per-vehicle
    // service history). Today no table references `vehiculo`, so this DELETE
    // cannot orphan anything and there is nothing to refuse.
    //
    // When the FK lands: `select` over `orden_servicio` for
    // `inArray(ordenServicio.vehiculoId, plan.delete)` inside this same `tx`,
    // and throw `ClienteValidationError({ vehicles: "..." })` for the ids it
    // finds — a 400 the form already renders under its bare `vehicles` key.
    // `TxLike` exposes `select` for exactly that; nothing about this plan, its
    // payload shape, or `CustomerForm` has to change to add it. Doing it in
    // the transaction rather than in `planVehiculoReconcile` is deliberate:
    // the reconcile is pure and cannot read, and a check outside the
    // transaction would race an order created between the check and the
    // DELETE. `ON DELETE RESTRICT` on that FK is the backstop; this check is
    // what turns the resulting error into Spanish copy instead of a 500.
    await tx.delete(vehiculo).where(and(eq(vehiculo.clienteId, clienteId), inArray(vehiculo.id, plan.delete)));
  }
}
