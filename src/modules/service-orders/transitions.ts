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
 * R21 — the ONLY valid transitions. `done` and `cancelled` are terminal (no
 * outgoing edges), nothing leads INTO `booked`, and `cancelled` is reachable
 * from every non-terminal status. `open -> in_progress` is intentionally
 * absent: the flow always passes `diagnosing`.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  booked: ["open", "cancelled"],
  open: ["diagnosing", "cancelled"],
  diagnosing: ["in_progress", "cancelled"],
  in_progress: ["on_hold", "ready_for_review", "done", "cancelled"],
  on_hold: ["in_progress", "cancelled"],
  ready_for_review: ["in_progress", "done", "cancelled"],
  done: [],
  cancelled: [],
};

/**
 * Targets the manual transition route must refuse: `diagnosing` is written when
 * a technician is assigned, `ready_for_review` by the last "Mi parte lista"
 * mark. They stay in the table so the writers that DO produce them can assert it.
 */
export const AUTOMATIC_TARGETS: ReadonlySet<OrderStatus> = new Set<OrderStatus>(["diagnosing", "ready_for_review"]);

/** The legal next states a person can pick: the table minus the automatic targets. */
export function getManualTransitions(from: OrderStatus): OrderStatus[] {
  return ALLOWED_TRANSITIONS[from].filter((next) => !AUTOMATIC_TARGETS.has(next));
}

/** R21 — throws OrderTransitionError for any transition not in ALLOWED_TRANSITIONS. */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new OrderTransitionError(from, to);
  }
}

/** R21 — thrown when the transition is legal but the caller may not make it. */
export class TransitionForbiddenError extends Error {
  constructor(
    public readonly from: OrderStatus,
    public readonly to: OrderStatus,
  ) {
    super(`This caller may not transition a service order from "${from}" to "${to}"`);
  }
}

/**
 * R21 — who may make a legal transition: ONLY the holders of `service-orders.assign`
 * (administrador, jefe_taller), which the CALLER evaluates with `can()` and passes in.
 * A técnico's only status effect is the readiness mark. Run AFTER `assertTransition`:
 * an illegal edge is a 400 whoever asks, and only a legal one can be forbidden.
 */
export function assertTransitionPermitted(canAssign: boolean, from: OrderStatus, to: OrderStatus): void {
  if (!canAssign) throw new TransitionForbiddenError(from, to);
}

/** `on_hold` needs a reason chosen per order, so only the single-order controls carry it. */
const BULK_EXCLUDED: ReadonlySet<OrderStatus> = new Set<OrderStatus>(["on_hold"]);

function getBulkTransitions(from: OrderStatus): OrderStatus[] {
  return getManualTransitions(from).filter((to) => !BULK_EXCLUDED.has(to));
}

/**
 * D9 — the target statuses legal from EVERY status in `froms`: the
 * INTERSECTION of each selected row's bulk transitions (manual, minus `on_hold`), which is what
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
 */
export function allowedTransitionsForAll(froms: readonly OrderStatus[]): OrderStatus[] {
  const [first, ...rest] = froms;
  if (first === undefined) return [];
  return rest.reduce<OrderStatus[]>(
    (common, from) => common.filter((next) => getBulkTransitions(from).includes(next)),
    getBulkTransitions(first),
  );
}
