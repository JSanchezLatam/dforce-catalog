/**
 * service-orders/order-lock.ts — the one place that decides whether an order
 * may be mutated (closed-order-lock). Generalizes `photos.ts#lockOpenOrder`:
 * lock the row with `SELECT … FOR UPDATE`, then refuse it or return it, so the
 * status gate and the write are one atomic step. The lock also serializes
 * concurrent writers, and `transitionOrder`'s UPDATE waits on it.
 *
 * Each mutation passes its OWN `canWrite(status)`; this module owns only the
 * lock and the closed/correction rule. A closed order is writable solely with a
 * `CorrectionGrant`, which `correction-auth.ts` issues after the password check
 * (outside the transaction: bcrypt must not hold this row lock).
 */
import { eq } from "drizzle-orm";

import type { db } from "@/shared/db/client";
import { ordenServicio, ordenServicioCorreccion, type OrdenServicio } from "@/shared/db/schema";
import { isClosedStatus } from "./edit-policy";
import { OrdenServicioNotFoundError } from "./service";
import type { OrderStatus } from "./transitions";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CorrectionGrant = { correctorId: string };

export class OrderClosedError extends Error {
  constructor() {
    super("La orden está cerrada; no se pueden cambiar sus fotos");
  }
}

export class OrderEditForbiddenError extends Error {
  constructor() {
    super("No tenés permiso para cambiar esta orden");
  }
}

export async function lockOrderForMutation(
  tx: Tx,
  id: string,
  opts: { canWrite: (status: OrderStatus) => boolean; correction?: CorrectionGrant },
): Promise<{ order: OrdenServicio; correcting: boolean }> {
  const [order] = await tx.select().from(ordenServicio).where(eq(ordenServicio.id, id)).for("update");
  if (!order) throw new OrdenServicioNotFoundError(id);
  if (opts.canWrite(order.status)) return { order, correcting: false };
  if (!isClosedStatus(order.status)) throw new OrderEditForbiddenError();
  if (!opts.correction) throw new OrderClosedError();
  return { order, correcting: true };
}

/** `text` columns: Date as ISO, number via `String()`, null as NULL. */
function encode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * One audit row per field whose encoded value changed; `after` names the fields
 * written, `before` is the LOCKED row (the form re-sends every field, so an
 * unchanged one must not produce a row). Runs in the caller's transaction.
 */
export async function recordCorrections(
  tx: Tx,
  input: { ordenId: string; userId: string; before: Record<string, unknown>; after: Record<string, unknown> },
): Promise<void> {
  const rows = Object.keys(input.after).flatMap((field) => {
    // `.set()` skips an undefined key, so that column was never written.
    if (input.after[field] === undefined) return [];
    const oldValue = encode(input.before[field]);
    const newValue = encode(input.after[field]);
    return oldValue === newValue
      ? []
      : [{ ordenId: input.ordenId, userId: input.userId, field, oldValue, newValue }];
  });
  if (rows.length === 0) return;
  await tx.insert(ordenServicioCorreccion).values(rows);
}
