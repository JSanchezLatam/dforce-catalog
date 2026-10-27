import { describe, expect, it } from "vitest";

import type { OrderStatus } from "@/modules/service-orders/transitions";

import { legalTargets, planMove } from "./plan";

const card = (status: OrderStatus, missing: ("vehiculo" | "categoria")[] = []) => ({ status, missing });

describe("planMove", () => {
  it("noop: the same column", () => {
    expect(planMove(card("in_progress"), "in_progress", true)).toEqual({ kind: "noop" });
  });

  it("noop: the viewer cannot move, even to a legal target", () => {
    expect(planMove(card("in_progress"), "on_hold", false)).toEqual({ kind: "noop" });
  });

  it("illegal: a target outside the state machine, or an automatic one", () => {
    expect(planMove(card("open"), "done", true)).toEqual({ kind: "illegal" });
    expect(planMove(card("in_progress"), "diagnosing", true)).toEqual({ kind: "illegal" });
    expect(planMove(card("in_progress"), "ready_for_review", true)).toEqual({ kind: "illegal" });
    expect(planMove(card("done"), "in_progress", true)).toEqual({ kind: "illegal" });
  });

  it("incomplete: receiving a booked order that lacks its vehicle or category", () => {
    expect(planMove(card("booked", ["vehiculo"]), "open", true)).toEqual({ kind: "incomplete" });
    expect(planMove(card("booked", ["categoria"]), "open", true)).toEqual({ kind: "incomplete" });
  });

  it("a complete booked order is received with a plain patch", () => {
    expect(planMove(card("booked"), "open", true)).toEqual({ kind: "patch" });
  });

  it("ask-reason: on_hold", () => {
    expect(planMove(card("in_progress"), "on_hold", true)).toEqual({ kind: "ask-reason" });
  });

  it("confirm: done, ready_for_review to in_progress, and cancelled", () => {
    expect(planMove(card("in_progress"), "done", true)).toEqual({ kind: "confirm" });
    expect(planMove(card("ready_for_review"), "in_progress", true)).toEqual({ kind: "confirm" });
    expect(planMove(card("open"), "cancelled", true)).toEqual({ kind: "confirm" });
  });

  it("patch: on_hold back to in_progress needs no confirmation", () => {
    expect(planMove(card("on_hold"), "in_progress", true)).toEqual({ kind: "patch" });
  });
});

describe("legalTargets", () => {
  it("excludes cancelled, diagnosing and ready_for_review", () => {
    expect(legalTargets("in_progress")).toEqual(["on_hold", "done"]);
    expect(legalTargets("booked")).toEqual(["open"]);
    expect(legalTargets("open")).toEqual([]);
    expect(legalTargets("on_hold")).toEqual(["in_progress"]);
    expect(legalTargets("ready_for_review")).toEqual(["in_progress", "done"]);
  });

  it("offers nothing from a closed order", () => {
    expect(legalTargets("done")).toEqual([]);
    expect(legalTargets("cancelled")).toEqual([]);
  });
});
