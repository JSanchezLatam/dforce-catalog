/**
 * kanban/plan.ts - the one pure rule set behind drag, menu and phone sheet. What a move needs
 * before it may reach the server; the server stays the authority (`transitionOrder`).
 */
import { getManualTransitions, type OrderStatus } from "@/modules/service-orders/transitions";

import type { KanbanCard } from "./shape";

export type MovePlan =
  | { kind: "noop" } // same column, or the viewer cannot move
  | { kind: "illegal" } // not in `getManualTransitions`
  | { kind: "incomplete" } // receiving a booked order that lacks vehicle or category
  | { kind: "ask-reason" } // on_hold needs a reason first
  | { kind: "confirm" } // done, ready_for_review -> in_progress (wipes readiness marks), cancelled
  | { kind: "patch" };

/** Drop targets: the manual transitions minus `cancelled`, which only the card menu offers. */
export function legalTargets(status: OrderStatus): OrderStatus[] {
  return getManualTransitions(status).filter((to) => to !== "cancelled");
}

export function planMove(card: Pick<KanbanCard, "status" | "missing">, target: OrderStatus, canMove: boolean): MovePlan {
  if (!canMove || target === card.status) return { kind: "noop" };
  if (!getManualTransitions(card.status).includes(target)) return { kind: "illegal" };
  if (target === "open" && card.missing.length > 0) return { kind: "incomplete" };
  if (target === "on_hold") return { kind: "ask-reason" };
  if (target === "done" || target === "cancelled" || (card.status === "ready_for_review" && target === "in_progress")) {
    return { kind: "confirm" };
  }
  return { kind: "patch" };
}
