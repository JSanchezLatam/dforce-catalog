/**
 * service-orders/assignments.ts — who is assigned to an order (Order Assignment).
 *
 * Assignments are only ever ADDED: there is no delete here or anywhere, and the
 * FKs are `restrict`. Assigning runs under `lockOrderForMutation` like every
 * other order write, so it serializes with a close and with a mark.
 *
 * A closed order refuses it for every role and is NOT correctable: this module
 * never takes a `CorrectionGrant`, so `OrderClosedError` is the only answer.
 */
import { inArray } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { ordenTecnico, tecnico } from "@/shared/db/schema";
import { isClosedStatus } from "./edit-policy";
import { lockOrderForMutation, type Tx } from "./order-lock";
import { applyReadiness } from "./readiness";
import type { OrderScope } from "./scope";

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

export type AssignDeps = { db?: typeof db };

/**
 * Assigns one technician. Returns `created: false` for a technician already on
 * the order (a no-op, not an error). A NEW assignment on a `ready_for_review`
 * order returns it to `in_progress` in the same transaction: the new assignee
 * has not marked, so the order is no longer ready.
 */
export async function assignTecnico(
  input: { ordenId: string; tecnicoId: string; assignedBy: string; scope: OrderScope },
  deps: AssignDeps = {},
): Promise<{ created: boolean }> {
  return (deps.db ?? db).transaction(async (tx) => {
    const { order } = await lockOrderForMutation(tx, input.ordenId, {
      scope: input.scope,
      canWrite: (status) => !isClosedStatus(status),
    });
    await assertActiveTecnicos(tx, [input.tecnicoId]);

    const inserted = await tx
      .insert(ordenTecnico)
      .values({ ordenId: input.ordenId, tecnicoId: input.tecnicoId, assignedBy: input.assignedBy })
      .onConflictDoNothing()
      .returning({ tecnicoId: ordenTecnico.tecnicoId });
    if (inserted.length === 0) return { created: false };

    // The new assignee has not marked, so a ready order is no longer ready: readiness owns that write.
    await applyReadiness(tx, order);
    return { created: true };
  });
}
