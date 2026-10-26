/**
 * service-orders/set-status.ts — the one place an order's status is written.
 *
 * `setStatus` asserts the full transition table, updates the order and appends the
 * history row, all in the caller's transaction (which must hold the order's
 * `FOR UPDATE` lock), so no writer can skip either the legality check or the row.
 * `recordStatus` only inserts; creation uses it directly for the null -> initial row.
 * Nothing here updates or deletes a history row.
 */
import { eq } from "drizzle-orm";

import { ordenEstadoHistorial, ordenServicio, type OrdenServicio } from "@/shared/db/schema";
import type { Tx } from "./order-lock";
import { assertTransition, type OrderStatus } from "./transitions";

type StatusRow = { ordenId: string; from: OrderStatus | null; to: OrderStatus; actor: string | null } & Pick<
  Partial<OrdenServicio>,
  "esperaMotivo"
>;

export async function recordStatus(tx: Tx, row: StatusRow): Promise<void> {
  await tx.insert(ordenEstadoHistorial).values({
    ordenId: row.ordenId,
    fromStatus: row.from,
    toStatus: row.to,
    esperaMotivo: row.esperaMotivo ?? null,
    changedBy: row.actor,
  });
}

export async function setStatus(
  tx: Tx,
  order: Pick<OrdenServicio, "id" | "status">,
  to: OrderStatus,
  actor: string | null,
  extra: Partial<Pick<OrdenServicio, "esperaMotivo" | "completedAt">> = {},
): Promise<OrdenServicio> {
  assertTransition(order.status, to);
  // `espera_motivo` is always written, so leaving `on_hold` clears it.
  const esperaMotivo = extra.esperaMotivo ?? null;
  const [row] = await tx
    .update(ordenServicio)
    .set({ status: to, esperaMotivo, updatedAt: new Date(), ...(extra.completedAt && { completedAt: extra.completedAt }) })
    .where(eq(ordenServicio.id, order.id))
    .returning();
  await recordStatus(tx, { ordenId: order.id, from: order.status, to, esperaMotivo, actor });
  return row;
}
