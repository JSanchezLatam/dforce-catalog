import { describe, expect, it } from "vitest";

import { orderStatusEnum } from "@/shared/db/schema";
import {
  allowedTransitionsForAll,
  AUTOMATIC_TARGETS,
  assertTransition,
  assertTransitionPermitted,
  getManualTransitions,
  OrderTransitionError,
  TransitionForbiddenError,
  type OrderStatus,
} from "./transitions";

/** The R21 pairs, written out by hand so the table cannot be read back from itself. */
const R21_PAIRS: [OrderStatus, OrderStatus][] = [
  ["booked", "open"],
  ["open", "diagnosing"],
  ["diagnosing", "in_progress"],
  ["in_progress", "on_hold"],
  ["on_hold", "in_progress"],
  ["in_progress", "ready_for_review"],
  ["ready_for_review", "in_progress"],
  ["in_progress", "done"],
  ["ready_for_review", "done"],
  ...(["booked", "open", "diagnosing", "in_progress", "on_hold", "ready_for_review"] as const).map(
    (from): [OrderStatus, OrderStatus] => [from, "cancelled"],
  ),
];

describe("the full transition table (R21)", () => {
  it("accepts exactly the R21 pairs and rejects every other pair", () => {
    const all = orderStatusEnum.enumValues;
    for (const from of all) {
      for (const to of all) {
        const legal = R21_PAIRS.some(([f, t]) => f === from && t === to);
        const accepted = (() => {
          try {
            assertTransition(from, to);
            return true;
          } catch (err) {
            if (err instanceof OrderTransitionError) return false;
            throw err;
          }
        })();
        expect(accepted, `${from} -> ${to}`).toBe(legal);
      }
    }
  });

  it("rejects open -> in_progress: the flow always passes diagnosing", () => {
    expect(() => assertTransition("open", "in_progress")).toThrow(OrderTransitionError);
  });

  it("lets nothing transition into booked", () => {
    for (const from of orderStatusEnum.enumValues) {
      expect(() => assertTransition(from, "booked")).toThrow(OrderTransitionError);
    }
  });
});

describe("AUTOMATIC_TARGETS and getManualTransitions", () => {
  it("holds exactly diagnosing and ready_for_review", () => {
    expect([...AUTOMATIC_TARGETS].sort()).toEqual(["diagnosing", "ready_for_review"]);
  });

  it("filters the automatic targets out of every status's manual transitions", () => {
    expect(getManualTransitions("open")).toEqual(["cancelled"]);
    expect(getManualTransitions("in_progress")).toEqual(["on_hold", "done", "cancelled"]);
    expect(getManualTransitions("diagnosing")).toEqual(["in_progress", "cancelled"]);
    expect(getManualTransitions("booked")).toEqual(["open", "cancelled"]);
    for (const from of orderStatusEnum.enumValues) {
      for (const to of getManualTransitions(from)) expect(AUTOMATIC_TARGETS.has(to)).toBe(false);
    }
  });
});

describe("assertTransition (R21)", () => {

  it("allows in_progress -> done", () => {
    expect(() => assertTransition("in_progress", "done")).not.toThrow();
  });

  it("allows open -> cancelled", () => {
    expect(() => assertTransition("open", "cancelled")).not.toThrow();
  });

  it("allows in_progress -> cancelled", () => {
    expect(() => assertTransition("in_progress", "cancelled")).not.toThrow();
  });

  it("rejects open -> done directly (skipping in_progress)", () => {
    expect(() => assertTransition("open", "done")).toThrow(OrderTransitionError);
  });

  it("rejects any transition out of done (terminal)", () => {
    expect(() => assertTransition("done", "open")).toThrow(OrderTransitionError);
    expect(() => assertTransition("done", "in_progress")).toThrow(OrderTransitionError);
    expect(() => assertTransition("done", "cancelled")).toThrow(OrderTransitionError);
  });

  it("rejects any transition out of cancelled (terminal)", () => {
    expect(() => assertTransition("cancelled", "open")).toThrow(OrderTransitionError);
    expect(() => assertTransition("cancelled", "in_progress")).toThrow(OrderTransitionError);
    expect(() => assertTransition("cancelled", "done")).toThrow(OrderTransitionError);
  });

  it("rejects a backward transition (in_progress -> open)", () => {
    expect(() => assertTransition("in_progress", "open")).toThrow(OrderTransitionError);
  });

  it("carries the from/to states on the thrown error for a clear message", () => {
    try {
      assertTransition("open", "done");
      expect.fail("expected assertTransition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OrderTransitionError);
      const transitionError = err as OrderTransitionError;
      expect(transitionError.from).toBe("open");
      expect(transitionError.to).toBe("done");
    }
  });
});

describe("ready_for_review edges", () => {
  it("leaves ready_for_review to in_progress, done and cancelled", () => {
    expect(getManualTransitions("ready_for_review")).toEqual(["in_progress", "done", "cancelled"]);
  });

  // Readiness is derived (applyReadiness), never chosen: no manual edge leads in.
  it.each(["booked", "open", "diagnosing", "on_hold", "ready_for_review", "done", "cancelled"] as const)(
    "rejects %s -> ready_for_review",
    (from) => {
      expect(() => assertTransition(from, "ready_for_review")).toThrow(OrderTransitionError);
    },
  );
});

describe("getManualTransitions as the status controls use it (R21)", () => {
  it("returns only cancelled for open: the start is automatic (diagnosing), not a button", () => {
    expect(getManualTransitions("open")).toEqual(["cancelled"]);
  });

  it("offers on_hold from in_progress: the single-order controls carry its reason", () => {
    expect(getManualTransitions("in_progress")).toEqual(["on_hold", "done", "cancelled"]);
  });

  it("returns an empty array for the terminal states (done, cancelled)", () => {
    expect(getManualTransitions("done")).toEqual([]);
    expect(getManualTransitions("cancelled")).toEqual([]);
  });
});

/**
 * Design D9 — what the bulk status menu is allowed to offer.
 *
 * The rule is the INTERSECTION of every selected row's manual transitions minus `on_hold`,
 * never the union and never the four statuses unconditionally: a menu built
 * from the union offers `done` over a selection holding one `open` row, and
 * every one of those rows comes back an `invalid_transition` the operator had
 * no way to predict from the menu they were shown.
 */
describe("allowedTransitionsForAll (D9 — the bulk status menu's intersection)", () => {
  it("leaves only cancelled for a selection of 3 open and 1 in_progress", () => {
    expect(allowedTransitionsForAll(["open", "open", "open", "in_progress"])).toEqual(["cancelled"]);
  });

  it("keeps diagnosing's next states when every selected row is diagnosing", () => {
    expect(allowedTransitionsForAll(["diagnosing", "diagnosing"])).toEqual(["in_progress", "cancelled"]);
  });

  /**
   * The negative half of the first case, spelled out so a union implementation
   * cannot pass on the "only cancelled" assertion alone: `in_progress` is legal
   * from `open` and `done` is legal from `in_progress`, and neither is legal
   * from both.
   */
  it("offers no status that is legal for only some of the selected rows", () => {
    const common = allowedTransitionsForAll(["diagnosing", "in_progress"]);
    expect(common).toEqual(["cancelled"]);
    expect(common).not.toContain("in_progress");
    expect(common).not.toContain("done");
  });

  // on_hold needs a reason chosen per order, so the bulk menu never carries it.
  it("never offers on_hold, even when every selected row could go on hold", () => {
    expect(allowedTransitionsForAll(["in_progress", "in_progress"])).toEqual(["done", "cancelled"]);
  });

  it("is empty once a terminal row is in the selection", () => {
    expect(allowedTransitionsForAll(["open", "done"])).toEqual([]);
    expect(allowedTransitionsForAll(["in_progress", "cancelled"])).toEqual([]);
  });

  /**
   * The mathematical identity of an intersection is the universe, which would
   * make an EMPTY selection offer every status. Nothing is selected, so no
   * bulk action is legal.
   */
  it("offers nothing for an empty selection", () => {
    expect(allowedTransitionsForAll([])).toEqual([]);
  });
});

describe("assertTransitionPermitted (R21, who may transition)", () => {
  const LEGAL_EDGES: [OrderStatus, OrderStatus][] = [
    ["open", "cancelled"],
    ["diagnosing", "in_progress"],
    ["on_hold", "in_progress"],
    ["booked", "open"],
    ["in_progress", "done"],
    ["in_progress", "cancelled"],
    ["ready_for_review", "in_progress"],
    ["ready_for_review", "done"],
    ["ready_for_review", "cancelled"],
  ];

  it.each(LEGAL_EDGES)("lets a holder of service-orders.assign do %s -> %s", (from, to) => {
    expect(() => assertTransitionPermitted(true, from, to)).not.toThrow();
  });

  it.each(LEGAL_EDGES)(
    "refuses %s -> %s for a caller without service-orders.assign",
    (from, to) => {
      expect(() => assertTransitionPermitted(false, from, to)).toThrow(TransitionForbiddenError);
    },
  );
});
