/**
 * service-orders/edit-policy.ts — D11. Who may edit an order's FIELDS, given
 * the acting role and the order's CURRENT status. Pure and DB-free, the same
 * shape `categories.ts` already establishes in this module.
 *
 * Not in `policy.ts`: `can(user, action)` reads a flat `MATRIX[role][action]`
 * and takes no order, and both roles hold `service-orders.write`
 * (`policy.ts:30` and `:43`). This is a second axis over `(role, status)`, not
 * a cell in a role x action table, so `policy.ts` and `ROUTE_GUARDS` are
 * unchanged and `service-orders.write` stays the coarse gate that runs first.
 *
 * Not in `transitions.ts`: that file's header scopes it to the status state
 * machine, and a role concern does not belong inside `assertTransition`'s file.
 *
 * The two call sites — the detail page (whether to render the control) and
 * `PATCH /api/service-orders/[id]` (whether to accept the write) — import this
 * one function so they cannot drift. The UI is convenience; the route is the
 * trust boundary and re-reads the status from the record.
 */
import type { Role } from "@/modules/auth/roles";

import type { OrderStatus } from "./transitions";

/**
 * D11's truth table, one cell per combination.
 *
 * `done` and `cancelled` refusing BOTH roles is this change's decision, not a
 * restatement of the request. `assertTransition` gives them no outgoing edges,
 * so a closed order cannot be reopened; letting its fields be rewritten anyway
 * would make closure reversible one field at a time while the badge still
 * reads "Completada". Correcting a wrongly-closed order is its own change.
 *
 * Written as an exhaustive `Record<Role, Record<OrderStatus, boolean>>` rather
 * than a boolean expression so that adding a role or a status is a tsc error
 * here instead of a silent default at two call sites.
 */
const EDITABLE: Record<Role, Record<OrderStatus, boolean>> = {
  administrador: { open: true, in_progress: true, done: false, cancelled: false },
  tecnico: { open: false, in_progress: true, done: false, cancelled: false },
};

/** D11 — true only for a `(role, status)` pair the table above permits. */
export function canEditOrderFields(role: Role, status: OrderStatus): boolean {
  // `?? false` for the same reason `can()` guards with `if (!grants) return
  // false` (policy.ts:65): `parseSessionUser` casts the `x-user-role` header
  // to `Role` without validating it, so `role` is a claim about a header, not
  // a fact. An unrecognised one must refuse, never throw a 500 at the route.
  return EDITABLE[role]?.[status] ?? false;
}
