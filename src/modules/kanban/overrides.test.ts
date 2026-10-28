import { describe, expect, it } from "vitest";

import { applyOverrides, type Override } from "./overrides";

const row = (id: string, status: "in_progress" | "on_hold" | "done" = "in_progress", urgent = false) => ({
  id,
  status,
  statusLabel: { in_progress: "En progreso", on_hold: "En espera", done: "Completada" }[status],
  urgent,
});
const map = (entries: [string, Override][]) => new Map(entries);

describe("applyOverrides", () => {
  it("keeps a pending move over an in-flight stale poll that still shows the old status", () => {
    const [out] = applyOverrides([row("a")], map([["a", { status: { value: "on_hold", seq: null } }]]), 7);
    expect(out).toMatchObject({ status: "on_hold", statusLabel: "En espera" });
  });

  it("keeps a confirmed move through one stale snapshot, and drops it at the second", () => {
    const o = map([["a", { status: { value: "on_hold", seq: 3 } }]]);
    expect(applyOverrides([row("a")], o, 3)[0].status).toBe("on_hold"); // the poll before the confirmation
    expect(applyOverrides([row("a")], o, 4)[0].status).toBe("on_hold"); // snapshot #1: may predate the PATCH
    expect(applyOverrides([row("a")], o, 5)[0].status).toBe("in_progress"); // snapshot #2: fresh, server wins
  });

  it("returns the very same row once it already matches the override", () => {
    const matching = row("a", "on_hold");
    const [out] = applyOverrides([matching], map([["a", { status: { value: "on_hold", seq: null } }]]), 1);
    expect(out).toBe(matching);
  });

  it("applies an urgent override on its own, leaving the status alone", () => {
    const [out] = applyOverrides([row("a", "on_hold")], map([["a", { urgent: { value: true, seq: null } }]]), 1);
    expect(out).toMatchObject({ status: "on_hold", urgent: true });
  });

  it("clears urgent, and drops that override after two good snapshots too", () => {
    const o = map([["a", { urgent: { value: false, seq: 1 } }]]);
    expect(applyOverrides([row("a", "in_progress", true)], o, 2)[0].urgent).toBe(false);
    expect(applyOverrides([row("a", "in_progress", true)], o, 3)[0].urgent).toBe(true);
  });

  it("settles each field on its own count: a mark confirmed at 3 drops at 5 while a move confirmed at 4 holds until 6", () => {
    const o = map([["a", { urgent: { value: true, seq: 3 }, status: { value: "on_hold", seq: 4 } }]]);
    expect(applyOverrides([row("a")], o, 4)[0]).toMatchObject({ status: "on_hold", urgent: true });
    expect(applyOverrides([row("a")], o, 5)[0]).toMatchObject({ status: "on_hold", urgent: false });
    expect(applyOverrides([row("a")], o, 6)[0]).toMatchObject({ status: "in_progress", urgent: false });
  });

  it("leaves other rows alone, and returns the same array when there is nothing to apply", () => {
    const rows = [row("a"), row("b")];
    expect(applyOverrides(rows, new Map(), 1)).toBe(rows);
    const out = applyOverrides(rows, map([["a", { status: { value: "done", seq: null } }]]), 1);
    expect(out[0].status).toBe("done");
    expect(out[1]).toBe(rows[1]);
  });
});
