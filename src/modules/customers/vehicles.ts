/**
 * customers/vehicles.ts — sole owner of `vehiculo` reads/writes
 * (vehicles-one-to-many, C3, design.md D3 "one owner"). Pages, the picker,
 * and the API only ever see plain arrays (`Vehiculo[]`, `plates: string[]`)
 * built here or composed into `queries.ts` — never a raw query builder.
 *
 * `service-orders-search-and-vehicle-catalog` D7 amends the "imported here
 * and nowhere else" claim below `vehiculoPlateExists` used to carry alone:
 * `service-orders/queries.ts` is now a SECOND value-import site for
 * `vehiculo`, joined one-to-one there rather than correlated through this
 * module — see the comment on `vehiculoPlateExists` for why that path does
 * not call it.
 */
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { db } from "@/shared/db/client";
import { cliente, ordenServicio, vehiculo, type Vehiculo } from "@/shared/db/schema";
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
 *
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
 *
 * `service-orders/queries.ts`'s order-list search does NOT call this
 * function, for two independent reasons (D7):
 *
 * 1. This correlates on `vehiculo.clienteId = cliente.id` — it answers "does
 *    this CUSTOMER own a vehicle with this plate". An order names exactly
 *    ONE vehicle (`orden_servicio.vehiculoId`); reused here, searching a
 *    plate would return that customer's orders for their OTHER cars too.
 * 2. This applies `activeVehiculoFilter()` — active vehicles only. An order
 *    can reference a vehicle deactivated afterwards
 *    (`service-orders/[id]/print/page.test.tsx` pins that such a vehicle
 *    still renders its identity), and reusing this would silently drop
 *    those orders from search.
 *
 * The orders path instead joins `vehiculo` directly and matches the plate as
 * a plain column comparison — the vehicle is 1:1 on that list, so there is
 * no customer-level correlation to get wrong.
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
 * reactivate every soft-deleted row in it (see `VehiculoInput`). An element
 * carrying `deleted: true` is the FOURTH outcome — the row is removed
 * outright, never updated and never deactivated on the way out. A re-added
 * plate with no id becomes a brand new row; this deliberately does
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
    // SEAM (C4, design.md D4) — referential-integrity check, filled now that
    // `orden_servicio.vehiculoId` exists. Runs inside this same `tx`,
    // immediately above the DELETE: `planVehiculoReconcile` is pure and cannot
    // read, and a check outside the transaction would race an order created
    // between the check and the DELETE. `ON DELETE RESTRICT` on that FK is
    // the backstop; this check is what turns the resulting error into
    // Spanish copy instead of a raw 500. The asymmetry is structural, not
    // conditional: this guards `plan.delete` only — `plan.deactivate` above
    // is untouched, so a vehicle with history stays soft-deletable.
    // Deliberately NOT scoped by clienteId, unlike every write in this
    // function. This read decides whether to block a delete, so over-matching
    // is the safe direction and under-matching is not: an orden_servicio row
    // reaching this vehicle under a different clienteId would be invisible to a
    // scoped check, the DELETE would proceed, and ON DELETE RESTRICT would
    // raise the raw 500 this guard exists to replace with Spanish copy. The
    // DELETE below stays scoped, because a write must never reach another
    // customer's row.
    const blocked = await tx
      .select({ id: ordenServicio.id })
      .from(ordenServicio)
      .where(inArray(ordenServicio.vehiculoId, plan.delete))
      .limit(1);
    if (blocked.length > 0) {
      throw new ClienteValidationError({
        vehicles: "No se puede eliminar un vehículo con órdenes de servicio. Desactivalo en su lugar.",
      });
    }
    await tx.delete(vehiculo).where(and(eq(vehiculo.clienteId, clienteId), inArray(vehiculo.id, plan.delete)));
  }
}

/**
 * The single-vehicle insert. Takes ONE vehicle, returns ONE row.
 *
 * D1/D2 — this function exists BECAUSE `planVehiculoReconcile` sixty lines
 * above cannot be reused for it: that one reads `incoming` as the customer's
 * WHOLE collection (see its deactivate filter and the "omitted from
 * `incoming`" comment), so handing it a one-element array deactivates every
 * other active vehicle the customer owns. It therefore NEVER calls
 * `planVehiculoReconcile` or `applyVehiculoPlan`, and `vehicles.test.ts`'s
 * "issues exactly one insert and zero updates" is the guard that says so on
 * every commit — `applyVehiculoPlan` issues an UPDATE per deactivation, so
 * routing this through it turns that test red.
 *
 * `deps.tx` is the same executor seam `applyVehiculoPlan` takes: a caller
 * already inside a transaction passes it; `POST /api/customers/[id]/vehicles`
 * does not, and gets the module's own `db`.
 */
export type NewVehiculoInput = Pick<VehiculoInput, "plate" | "make" | "model" | "year">;

export async function createVehiculo(
  clienteId: string,
  input: NewVehiculoInput,
  deps: { tx?: TxLike } = {},
): Promise<Vehiculo> {
  const executor = deps.tx ?? db;
  const [row] = await executor
    .insert(vehiculo)
    .values({
      clienteId,
      plate: input.plate,
      make: input.make ?? null,
      model: input.model ?? null,
      year: input.year ?? null,
    })
    .returning();
  return row;
}
