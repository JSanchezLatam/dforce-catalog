/**
 * design.md D2 — sequencing is a safety invariant, not politeness.
 *
 * `deactivateUser()` re-reads `activeAdminIds` INSIDE its own transaction, and
 * this app's Postgres runs at `read committed`. Two overlapping calls therefore
 * both observe the same two active admins, both conclude their own target is
 * safe to remove, and both commit: zero administrators, with the correct
 * per-row route taken and every transaction intact. `Promise.all` over the
 * right endpoint is as fatal as a bulk `UPDATE`.
 *
 * So the first test in this file is not a style assertion. Swap the runner's
 * body for `Promise.all` and it must go RED **by name** — that mutation is
 * task 4.3 and it is the only evidence this guarantee exists.
 */
import { describe, expect, it, vi } from "vitest";

import { runSequential, type RowOutcome } from "./run-sequential";

/** A promise the test releases by hand, so a row can be held mid-flight. */
function gate() {
  let open!: () => void;
  const passed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { passed, open };
}

/** Let every already-scheduled microtask AND macrotask settle. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("runSequential", () => {
  it("never has two rows in flight at once", async () => {
    const gates: ReturnType<typeof gate>[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const apply = vi.fn(async (id: string): Promise<RowOutcome> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const g = gate();
      gates.push(g);
      await g.passed;
      inFlight -= 1;
      return { id, ok: true };
    });

    const running = runSequential(["a", "b", "c"], apply);

    // Nothing has been released yet, so a sequential runner is parked on "a"
    // and has not looked at "b". `Promise.all` has all three open here.
    await flush();
    expect(maxInFlight).toBe(1);
    expect(apply).toHaveBeenCalledTimes(1);

    gates[0].open();
    await flush();
    expect(maxInFlight).toBe(1);
    expect(apply).toHaveBeenCalledTimes(2);

    gates[1].open();
    await flush();
    expect(maxInFlight).toBe(1);
    expect(apply).toHaveBeenCalledTimes(3);

    gates[2].open();
    await running;
    expect(maxInFlight).toBe(1);
  });

  it("returns one outcome per id, in the order the ids were given", async () => {
    // Descending delays: a runner that resolved in COMPLETION order would put
    // "c" first. A sequential one cannot, and neither can `Promise.all` — this
    // pins the contract callers read the panel from, not the concurrency.
    const delayFor: Record<string, number> = { a: 30, b: 20, c: 10 };
    const outcomes = await runSequential(["a", "b", "c"], async (id) => {
      await new Promise((resolve) => setTimeout(resolve, delayFor[id]));
      return id === "b" ? { id, ok: false, reason: "last_active_admin" } : { id, ok: true };
    });

    expect(outcomes).toEqual([
      { id: "a", ok: true },
      { id: "b", ok: false, reason: "last_active_admin" },
      { id: "c", ok: true },
    ]);
  });

  it("stops before the next row once the signal is aborted", async () => {
    const signal = { aborted: false };
    const seen: string[] = [];

    const outcomes = await runSequential(
      ["a", "b", "c", "d"],
      async (id) => {
        seen.push(id);
        if (id === "b") signal.aborted = true;
        return { id, ok: true };
      },
      signal,
    );

    // "Cancelar" stops before the NEXT request, not after the last one: "b"
    // was already in flight and is reported, "c" and "d" were never issued.
    expect(seen).toEqual(["a", "b"]);
    expect(outcomes.map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("issues nothing at all when the signal is already aborted", async () => {
    const apply = vi.fn();
    const outcomes = await runSequential(["a", "b"], apply, { aborted: true });

    expect(apply).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
  });

  it("reports a row whose request threw instead of losing the whole batch", async () => {
    // Beyond task 4.1's listed cases, and deliberate: the spec's Per-Row
    // Partial Success Reporting requires every row that did not apply to be
    // named with its own reason. A rejected `fetch` on row 2 that propagated
    // out of here would take rows 1 and 3's outcomes with it and leave the
    // panel with nothing to render — the one failure mode the requirement
    // exists to forbid, arriving through the caller's error path.
    const outcomes = await runSequential(["a", "b", "c"], async (id) => {
      if (id === "b") throw new Error("network down");
      return { id, ok: true };
    });

    expect(outcomes).toEqual([
      { id: "a", ok: true },
      { id: "b", ok: false, reason: "request_failed" },
      { id: "c", ok: true },
    ]);
  });
});
