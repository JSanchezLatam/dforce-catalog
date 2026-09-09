import { describe, expect, it } from "vitest";

import {
  allowedTransitionsForAll,
  assertTransition,
  getAllowedTransitions,
  OrderTransitionError,
} from "./transitions";

describe("assertTransition (R21)", () => {
  it("allows open -> in_progress", () => {
    expect(() => assertTransition("open", "in_progress")).not.toThrow();
  });

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

describe("getAllowedTransitions (R21 — Phase 6 status-transition controls)", () => {
  it("returns the two legal next states for open", () => {
    expect(getAllowedTransitions("open")).toEqual(["in_progress", "cancelled"]);
  });

  it("returns the two legal next states for in_progress", () => {
    expect(getAllowedTransitions("in_progress")).toEqual(["done", "cancelled"]);
  });

  it("returns an empty array for the terminal states (done, cancelled)", () => {
    expect(getAllowedTransitions("done")).toEqual([]);
    expect(getAllowedTransitions("cancelled")).toEqual([]);
  });
});

/**
 * Design D9 — what the bulk status menu is allowed to offer.
 *
 * The rule is the INTERSECTION of every selected row's `getAllowedTransitions`,
 * never the union and never the four statuses unconditionally: a menu built
 * from the union offers `done` over a selection holding one `open` row, and
 * every one of those rows comes back an `invalid_transition` the operator had
 * no way to predict from the menu they were shown.
 */
describe("allowedTransitionsForAll (D9 — the bulk status menu's intersection)", () => {
  it("leaves only cancelled for a selection of 3 open and 1 in_progress", () => {
    expect(allowedTransitionsForAll(["open", "open", "open", "in_progress"])).toEqual(["cancelled"]);
  });

  it("keeps both of open's next states when every selected row is open", () => {
    expect(allowedTransitionsForAll(["open", "open"])).toEqual(["in_progress", "cancelled"]);
  });

  /**
   * The negative half of the first case, spelled out so a union implementation
   * cannot pass on the "only cancelled" assertion alone: `in_progress` is legal
   * from `open` and `done` is legal from `in_progress`, and neither is legal
   * from both.
   */
  it("offers no status that is legal for only some of the selected rows", () => {
    const common = allowedTransitionsForAll(["open", "in_progress"]);
    expect(common).not.toContain("in_progress");
    expect(common).not.toContain("done");
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

  /**
   * `getAllowedTransitions` hands back the live `ALLOWED_TRANSITIONS` row, so a
   * single-row selection must not become a writable alias to the state machine
   * itself.
   */
  it("never returns the transition table's own array", () => {
    const common = allowedTransitionsForAll(["open"]);
    common.pop();
    expect(getAllowedTransitions("open")).toEqual(["in_progress", "cancelled"]);
  });
});
