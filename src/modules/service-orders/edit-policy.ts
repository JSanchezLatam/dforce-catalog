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
 * `updateOrder` (whether to accept the write) — import this one function so
 * they cannot drift. The UI is convenience; `updateOrder` is the trust
 * boundary and reads the status from the row it has locked (`order-lock.ts`).
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
 * reads "Completada". Correcting a closed order goes through `order-lock.ts` with an administrator `CorrectionGrant` (closed-order-lock).
 *
 * Written as an exhaustive `Record<Role, Record<OrderStatus, boolean>>` rather
 * than a boolean expression so that adding a role or a status is a tsc error
 * here instead of a silent default at two call sites.
 */
const EDITABLE: Record<Role, Record<OrderStatus, boolean>> = {
  administrador: { open: true, in_progress: true, ready_for_review: true, done: false, cancelled: false },
  jefe_taller: { open: true, in_progress: true, ready_for_review: true, done: false, cancelled: false },
  tecnico: { open: false, in_progress: true, ready_for_review: false, done: false, cancelled: false },
};

/** D11 — true only for a `(role, status)` pair the table above permits. */
export function canEditOrderFields(role: Role, status: OrderStatus): boolean {
  // `?? false` for the same reason `can()` guards with `if (!grants) return
  // false` (policy.ts:65): `parseSessionUser` casts the `x-user-role` header
  // to `Role` without validating it, so `role` is a claim about a header, not
  // a fact. An unrecognised one must refuse, never throw a 500 at the route.
  return EDITABLE[role]?.[status] ?? false;
}

/**
 * Reception photos follow the ORDER's status: a técnico must photograph an
 * `open` order even though D11 refuses them its field edits. The one role split
 * is review: `ready_for_review` takes photos from staff only (`"staff"` = the
 * caller holds `service-orders.assign`). Who may DELETE is a role question and
 * lives in `policy.ts` (`service-orders.deletePhoto`). Exhaustive, so a new
 * status is a tsc error here.
 */
const PHOTOS_CHANGEABLE: Record<OrderStatus, "all" | "staff" | "none"> = {
  open: "all",
  in_progress: "all",
  ready_for_review: "staff",
  done: "none",
  cancelled: "none",
};

/** True while the order takes photos from this caller; photos are frozen once it closes. */
export function canChangeOrderPhotos(status: OrderStatus, staff: boolean): boolean {
  const who = PHOTOS_CHANGEABLE[status] ?? "none";
  return who === "all" || (who === "staff" && staff);
}

/** Closed orders are locked: only an authenticated administrator correction (closed-order-lock) may change them. Exhaustive, so a new status is a tsc error here. */
const CLOSED: Record<OrderStatus, boolean> = {
  open: false,
  in_progress: false,
  ready_for_review: false,
  done: true,
  cancelled: true,
};

export function isClosedStatus(status: OrderStatus): boolean {
  return CLOSED[status] ?? false;
}

/**
 * What the detail page offers for `(role, status)`. A closed order is never
 * plainly editable: an administrador may CORRECT it (password required, audited
 * server-side); anyone else is refused. The server stays the trust boundary —
 * this only decides which control to render.
 *
 * The role literal mirrors `service-orders.correct` in `policy.ts`, which this
 * file cannot import for its `can()` (it takes a user, and the page tests mock
 * that module); `edit-policy.test.ts` pins the two together.
 */
export function orderEditMode(role: Role, status: OrderStatus): "edit" | "correction" | "refused" {
  if (canEditOrderFields(role, status)) return "edit";
  return isClosedStatus(status) && role === "administrador" ? "correction" : "refused";
}

/**
 * Who may write a work line, by role and status — the same split the work-line
 * routes enforce (`work-lines.ts`): staff while `in_progress` or
 * `ready_for_review`, a técnico only `in_progress`, nobody on `open`, and on a
 * closed order only an administrador's password-backed correction (a jefe never
 * holds a grant). A técnico's own-line and not-yet-marked conditions are data
 * the page does not have here; the card checks them and the server stays the gate.
 */
export function workLineMode(role: Role, status: OrderStatus): "write" | "correction" | "refused" {
  const staff = role === "administrador" || role === "jefe_taller";
  if (isClosedStatus(status)) return role === "administrador" ? "correction" : "refused";
  if (status === "in_progress") return staff || role === "tecnico" ? "write" : "refused";
  return staff && status === "ready_for_review" ? "write" : "refused";
}
