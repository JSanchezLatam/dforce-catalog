import { inArray } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { ordenEstadoHistorial, ordenServicio } from "@/shared/db/schema";

/**
 * The history FK to the order is `restrict` (an order with history is not deletable), so a
 * suite that tears down its orders removes their history rows first. Teardown only: no
 * production path deletes history.
 */
export async function purgeHistory(clienteIds: readonly string[]): Promise<void> {
  if (clienteIds.length === 0) return;
  await db
    .delete(ordenEstadoHistorial)
    .where(inArray(ordenEstadoHistorial.ordenId, db.select({ id: ordenServicio.id }).from(ordenServicio).where(inArray(ordenServicio.clienteId, [...clienteIds]))));
}
