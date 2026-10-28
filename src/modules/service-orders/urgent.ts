/**
 * service-orders/urgent.ts — the manual "Urgente" flag (kanban-board).
 *
 * Writes ONLY `urgente_at`/`urgente_by`: `updatedAt` is the board's time-in-status
 * fallback, so touching it would reset every card's age. Setting an urgent order or
 * clearing a plain one writes nothing (idempotent; the first setter stays). A closed
 * order is refused and not correctable, as for assignment.
 */
import { eq } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { ordenServicio } from "@/shared/db/schema";
import { isClosedStatus } from "./edit-policy";
import { lockOrderForMutation, type Tx } from "./order-lock";
import type { OrderScope } from "./scope";

export type UrgentDeps = { scope: OrderScope; actorId: string; db?: typeof db };

export async function setUrgent(id: string, on: boolean, deps: UrgentDeps): Promise<{ urgent: boolean }> {
  return (deps.db ?? db).transaction(async (tx: Tx) => {
    const { order } = await lockOrderForMutation(tx, id, {
      scope: deps.scope,
      canWrite: (status) => !isClosedStatus(status),
    });
    if (on === (order.urgenteAt !== null)) return { urgent: on };
    await tx
      .update(ordenServicio)
      .set(on ? { urgenteAt: new Date(), urgenteBy: deps.actorId } : { urgenteAt: null, urgenteBy: null })
      .where(eq(ordenServicio.id, id));
    return { urgent: on };
  });
}
