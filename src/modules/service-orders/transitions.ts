/**
 * service-orders/transitions.ts — pure order-status state machine (R21).
 *
 * Mirrors catalog-builder/selection.ts's convention: DB-free, unit-tested
 * first, all transition-legality rules live here so service.ts only needs to
 * call `assertTransition()` before writing a status change — no branching
 * logic duplicated at the write site.
 */
import { orderStatusEnum } from "@/shared/db/schema";

export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];

/** R21 — thrown for any transition not explicitly allowed by ALLOWED_TRANSITIONS. */
export class OrderTransitionError extends Error {
  constructor(
    public readonly from: OrderStatus,
    public readonly to: OrderStatus,
  ) {
    super(`Cannot transition service order from "${from}" to "${to}"`);
  }
}

/**
 * R21 — the ONLY valid transitions. `done` and `cancelled` have no outgoing
 * edges (terminal states); direct `open -> done` is intentionally absent
 * (skipping `in_progress` is rejected).
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  open: ["in_progress", "cancelled"],
  in_progress: ["done", "cancelled"],
  done: [],
  cancelled: [],
};

/** R21 — throws OrderTransitionError for any transition not in ALLOWED_TRANSITIONS. */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new OrderTransitionError(from, to);
  }
}

/**
 * Phase 6 — read-only lookup of the legal next states for `from`, so the
 * order-detail page's status-transition controls can render only the
 * buttons/options that would actually pass `assertTransition` (no duplicated
 * transition table on the UI side; terminal states return `[]`).
 */
export function getAllowedTransitions(from: OrderStatus): OrderStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

/**
 * D9 — the target statuses legal from EVERY status in `froms`: the
 * INTERSECTION of each selected row's `getAllowedTransitions`, which is what
 * the bulk status menu is allowed to offer.
 *
 * Never the union, and never the four statuses unconditionally. A menu built
 * from the union offers `done` over a selection holding one `open` row, and
 * each of those rows then comes back an `invalid_transition` the operator had
 * no way to predict from the menu they were shown — `assertTransition` is
 * evaluated per row against that row's CURRENT status, so the menu is the only
 * place the whole-selection rule can be stated up front.
 *
 * An empty selection returns `[]` rather than the identity of an intersection
 * (the universe): nothing is selected, so no bulk action is legal.
 *
 * The accumulator is a COPY — `getAllowedTransitions` hands back the live
 * `ALLOWED_TRANSITIONS` row, and a one-row selection would otherwise return a
 * writable alias to the state machine itself.
 */
export function allowedTransitionsForAll(froms: readonly OrderStatus[]): OrderStatus[] {
  const [first, ...rest] = froms;
  if (first === undefined) return [];
  return rest.reduce<OrderStatus[]>(
    (common, from) => common.filter((next) => getAllowedTransitions(from).includes(next)),
    [...getAllowedTransitions(first)],
  );
}
