/**
 * service-orders/assignments.ts — who is assigned to an order (Order Assignment).
 * Assignments are only ever ADDED: there is no delete here or anywhere.
 */
import { inArray } from "drizzle-orm";

import { tecnico } from "@/shared/db/schema";
import type { Tx } from "./order-lock";

/** An id that is unknown or deactivated: one error for both, so the roster is not probed. */
export class InvalidTecnicoError extends Error {
  constructor(readonly errors: { tecnicoIds: string }) {
    super("Invalid tecnico");
  }
}

/**
 * Throws `InvalidTecnicoError` unless EVERY id is an active roster row. Takes the
 * caller's transaction. ponytail: no `FOR SHARE` on the roster rows, so a
 * technician deactivated between this check and the commit is still assigned;
 * harmless (history keeps them) and deactivation never revokes an assignment.
 */
export async function assertActiveTecnicos(tx: Tx, ids: readonly string[]): Promise<void> {
  const rows = await tx
    .select({ id: tecnico.id, deactivatedAt: tecnico.deactivatedAt })
    .from(tecnico)
    .where(inArray(tecnico.id, [...ids]));
  const active = rows.filter((row) => row.deactivatedAt === null);
  if (active.length !== new Set(ids).size) {
    throw new InvalidTecnicoError({ tecnicoIds: "Elegí técnicos activos" });
  }
}
