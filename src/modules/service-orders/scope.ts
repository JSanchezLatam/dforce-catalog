/**
 * service-orders/scope.ts — the ONE predicate "may this caller see this order".
 *
 * Every order read takes a REQUIRED `OrderScope`, so a forgotten path is a tsc
 * error rather than a fail-open leak. `where` is `undefined` only for callers
 * that legitimately see everything; a técnico gets an `EXISTS` over their own
 * roster row's assignments. A técnico with no roster row, or a role the matrix
 * does not know, matches nothing (the `EXISTS` finds no row).
 *
 * A deactivated roster row keeps its assigned orders visible: the spec keeps a
 * deactivated technician on every historical assignment and only withholds
 * them from NEW assignments. Revoking access is the login's `deactivated_at`.
 */
import { and, eq, exists, type SQL } from "drizzle-orm";

import { can } from "@/modules/auth/policy";
import { db } from "@/shared/db/client";
import { ordenServicio, ordenTecnico, tecnico } from "@/shared/db/schema";

export type OrderScope = { readonly where: SQL | undefined };

/** Jobs, reminders and other non-user callers: sees every order, and says so at the call site. */
export const SYSTEM_SCOPE: OrderScope = { where: undefined };

/** Correlates on `orden_servicio.id`, so the query it joins must select FROM `orden_servicio`. */
export function orderScope(user: { id: string; role: string }): OrderScope {
  if (can(user, "service-orders.readAll")) return SYSTEM_SCOPE;
  return {
    where: exists(
      db
        .select({ one: ordenTecnico.ordenId })
        .from(ordenTecnico)
        .innerJoin(tecnico, eq(ordenTecnico.tecnicoId, tecnico.id))
        .where(and(eq(ordenTecnico.ordenId, ordenServicio.id), eq(tecnico.userId, user.id))),
    ),
  };
}
