/**
 * service-orders/readiness.ts — "Lista para revisión" is DERIVED, never chosen.
 *
 * `applyReadiness` recomputes an order's status from its assignments and writes
 * `in_progress <-> ready_for_review` WITHOUT `assertTransition`: no manual edge
 * leads into `ready_for_review`. It runs inside the caller's transaction, which
 * must already hold the order's `FOR UPDATE` lock (`lockOrderForMutation`): that
 * lock is what makes two last marks serialize, so the second counts the first.
 *
 * Ready means at least one ACTIVE assignee and every active assignee marked. A
 * deactivated technician never blocks (and never alone satisfies) readiness.
 */
import { eq } from "drizzle-orm";

import { ordenServicio, ordenTecnico, tecnico } from "@/shared/db/schema";
import type { Tx } from "./order-lock";
import type { OrderStatus } from "./transitions";

/** Returns the order's status after the recomputation; any other status is returned untouched, unread. */
export async function applyReadiness(tx: Tx, order: { id: string; status: OrderStatus }): Promise<OrderStatus> {
  if (order.status !== "in_progress" && order.status !== "ready_for_review") return order.status;

  const rows = await tx
    .select({ parteListaAt: ordenTecnico.parteListaAt, deactivatedAt: tecnico.deactivatedAt })
    .from(ordenTecnico)
    .innerJoin(tecnico, eq(ordenTecnico.tecnicoId, tecnico.id))
    .where(eq(ordenTecnico.ordenId, order.id));
  const active = rows.filter((row) => row.deactivatedAt === null);
  const next: OrderStatus =
    active.length > 0 && active.every((row) => row.parteListaAt !== null) ? "ready_for_review" : "in_progress";

  // `updatedAt` is the only timestamp a derived transition has: the table keeps no per-status history.
  if (next !== order.status) {
    await tx.update(ordenServicio).set({ status: next, updatedAt: new Date() }).where(eq(ordenServicio.id, order.id));
  }
  return next;
}
