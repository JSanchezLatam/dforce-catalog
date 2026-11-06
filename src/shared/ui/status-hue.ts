/**
 * The one source of the order-status hues. `--h`/`--s` feed `.board-hue-*`, `.hue-tint` and
 * `.hue-fill` in globals.css, so the badge, the status buttons, the board columns and the backlog
 * dots all read the same numbers. Values are the approved kanban mockup's. `cancelled` has no hue.
 * Lives in `shared/` (which never imports `modules/`), so the key type is spelled out here.
 */
export type HuedOrderStatus = "booked" | "open" | "diagnosing" | "in_progress" | "on_hold" | "ready_for_review" | "done";

export const ORDER_HUE: Record<HuedOrderStatus, { h: number; s: string }> = {
  booked: { h: 188, s: "70%" },
  open: { h: 221, s: "70%" },
  diagnosing: { h: 262, s: "60%" },
  in_progress: { h: 290, s: "50%" },
  on_hold: { h: 220, s: "14%" },
  ready_for_review: { h: 168, s: "60%" },
  done: { h: 142, s: "55%" },
};
