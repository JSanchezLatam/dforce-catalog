/**
 * customers/vehicles.ts — sole owner of `vehiculo` reads/writes
 * (vehicles-one-to-many, C3, design.md D3 "one owner"). Pages, the picker,
 * and the API only ever see plain arrays (`Vehiculo[]`, `plates: string[]`)
 * built here or composed into `queries.ts` — never a raw query builder.
 */
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { vehiculo, type Vehiculo } from "@/shared/db/schema";
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
 * insertion order. Column names are hardcoded (not interpolated `Column`
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
  return sql<string[]>`(select coalesce(array_agg("vehiculo"."plate" order by "vehiculo"."created_at"), '{}')
    from "vehiculo" where "vehiculo"."cliente_id" = "cliente"."id" and "vehiculo"."deactivated_at" is null)`;
}

/** R16 — a customer's active vehicles. */
export async function listVehiculosByCliente(
  clienteId: string,
  queryFn: () => Promise<Vehiculo[]> = () =>
    db
      .select()
      .from(vehiculo)
      .where(and(eq(vehiculo.clienteId, clienteId), activeVehiculoFilter())),
): Promise<Vehiculo[]> {
  return queryFn();
}

/**
 * D5 — pure reconcile. `existing` is the customer's current ACTIVE vehicles;
 * `incoming` is the already-validated payload. Omitted `incoming` leaves the
 * collection completely untouched (R16); `[]` deactivates every active
 * vehicle. An element WITH `id` is an update, WITHOUT `id` is an insert —
 * plates are never the key (editable, not unique). An `id` absent from
 * `existing` (another customer's, or an already-deactivated vehicle) throws
 * rather than silently inserting — a trust boundary, not a data-shape bug.
 * A re-added plate with no id becomes a brand new row; this deliberately
 * does not resurrect a deactivated one (ponytail: revive-on-match if history
 * continuity is ever asked for).
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

  const deactivate = existing.filter((v) => !keptIds.has(v.id)).map((v) => v.id);
  return { inserts, updates, deactivate };
}

/** D5 — executes a plan inside `tx`; the transaction stays a dumb executor of the pure plan above. */
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
    await tx
      .update(vehiculo)
      .set({ plate: v.plate, make: v.make ?? null, model: v.model ?? null, year: v.year ?? null })
      .where(eq(vehiculo.id, v.id!));
  }

  if (plan.deactivate.length > 0) {
    await tx.update(vehiculo).set({ deactivatedAt: new Date() }).where(inArray(vehiculo.id, plan.deactivate));
  }
}
