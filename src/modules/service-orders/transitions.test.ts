import { describe, expect, it } from "vitest";

import { assertTransition, OrderTransitionError } from "./transitions";

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
