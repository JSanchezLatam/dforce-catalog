import { describe, expect, it } from "vitest";

import { lockOrderForMutation, OrderClosedError, OrderEditForbiddenError, recordCorrections } from "./order-lock";
import { OrdenServicioNotFoundError } from "./service";
import type { OrderStatus } from "./transitions";

/**
 * Answers by statement order, the way `photos.test.ts` does: Drizzle's builder
 * is not stringifiable, so the Nth awaited statement gets the Nth queued result.
 * `forArgs` records what was passed to `.for(...)`, `inserted` every `.values(...)`.
 */
function fakeTx(results: unknown[][] = []) {
  const forArgs: unknown[] = [];
  const inserted: unknown[] = [];
  let next = 0;
  const statement = () => {
    const chain: unknown = new Proxy(function () {}, {
      get(_, prop) {
        if (prop === "then") {
          const result = results[next++] ?? [];
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          if (prop === "for") forArgs.push(args[0]);
          if (prop === "values") inserted.push(args[0]);
          return chain;
        };
      },
    });
    return chain;
  };
  const tx = { select: statement, insert: statement } as never;
  return { tx, forArgs, inserted, statements: () => next };
}

const row = (status: OrderStatus) => ({ id: "ord-1", status });
const anyStatus = () => true;
const noStatus = () => false;
const grant = { correctorId: "admin-1" };

describe("lockOrderForMutation", () => {
  it("throws OrdenServicioNotFoundError when the order does not exist", async () => {
    const { tx } = fakeTx([[]]);
    await expect(lockOrderForMutation(tx, "ord-1", { canWrite: anyStatus })).rejects.toBeInstanceOf(
      OrdenServicioNotFoundError,
    );
  });

  it("returns correcting:false when the order is open and canWrite allows it", async () => {
    const { tx } = fakeTx([[row("open")]]);
    const out = await lockOrderForMutation(tx, "ord-1", { canWrite: (s) => s === "open" });
    expect(out).toEqual({ order: row("open"), correcting: false });
  });

  it.each<OrderStatus>(["done", "cancelled"])("returns correcting:true for a %s order with a grant", async (status) => {
    const { tx } = fakeTx([[row(status)]]);
    const out = await lockOrderForMutation(tx, "ord-1", { canWrite: noStatus, correction: grant });
    expect(out).toEqual({ order: row(status), correcting: true });
  });

  it.each<OrderStatus>(["done", "cancelled"])("throws OrderClosedError for a %s order without a grant", async (status) => {
    const { tx } = fakeTx([[row(status)]]);
    await expect(lockOrderForMutation(tx, "ord-1", { canWrite: noStatus })).rejects.toBeInstanceOf(OrderClosedError);
  });

  it("throws OrderEditForbiddenError for an open order the caller may not write", async () => {
    const { tx } = fakeTx([[row("open")]]);
    await expect(lockOrderForMutation(tx, "ord-1", { canWrite: noStatus })).rejects.toBeInstanceOf(
      OrderEditForbiddenError,
    );
  });

  it("ignores a grant on an open order the caller may not write", async () => {
    const { tx } = fakeTx([[row("in_progress")]]);
    await expect(lockOrderForMutation(tx, "ord-1", { canWrite: noStatus, correction: grant })).rejects.toBeInstanceOf(
      OrderEditForbiddenError,
    );
  });

  it("lets a closed order through when canWrite allows it (a status transition) and reports no correction", async () => {
    const { tx } = fakeTx([[row("done")]]);
    const out = await lockOrderForMutation(tx, "ord-1", { canWrite: anyStatus });
    expect(out.correcting).toBe(false);
  });

  it("locks the row with FOR UPDATE", async () => {
    const { tx, forArgs } = fakeTx([[row("open")]]);
    await lockOrderForMutation(tx, "ord-1", { canWrite: anyStatus });
    expect(forArgs).toEqual(["update"]);
  });
});

describe("recordCorrections", () => {
  const base = { ordenId: "ord-1", userId: "admin-1" };

  it("encodes a Date as ISO, a number via String() and null as NULL", async () => {
    const { tx, inserted } = fakeTx();
    await recordCorrections(tx, {
      ...base,
      before: { appointmentAt: null, kilometraje: 100, hallazgos: "x" },
      after: { appointmentAt: new Date("2026-10-06T12:00:00.000Z"), kilometraje: 250, hallazgos: null },
    });
    expect(inserted).toEqual([
      [
        { ...base, field: "appointmentAt", oldValue: null, newValue: "2026-10-06T12:00:00.000Z" },
        { ...base, field: "kilometraje", oldValue: "100", newValue: "250" },
        { ...base, field: "hallazgos", oldValue: "x", newValue: null },
      ],
    ]);
  });

  it("writes one row per CHANGED field only", async () => {
    const { tx, inserted } = fakeTx();
    await recordCorrections(tx, {
      ...base,
      before: { hallazgos: "same", recomendaciones: "old" },
      after: { hallazgos: "same", recomendaciones: "new" },
    });
    expect(inserted).toEqual([[{ ...base, field: "recomendaciones", oldValue: "old", newValue: "new" }]]);
  });

  it("treats an equal Date as unchanged", async () => {
    const { tx, statements } = fakeTx();
    await recordCorrections(tx, {
      ...base,
      before: { appointmentAt: new Date("2026-10-06T12:00:00.000Z") },
      after: { appointmentAt: new Date("2026-10-06T12:00:00.000Z") },
    });
    expect(statements()).toBe(0);
  });

  it("skips a key whose value is undefined, as drizzle's .set() leaves that column untouched", async () => {
    const { tx, inserted } = fakeTx();
    await recordCorrections(tx, {
      ...base,
      before: { hallazgos: "x", recomendaciones: "old" },
      after: { hallazgos: undefined, recomendaciones: "new" },
    });
    expect(inserted).toEqual([[{ ...base, field: "recomendaciones", oldValue: "old", newValue: "new" }]]);
  });

  it("writes nothing when no field changed", async () => {
    const { tx, statements } = fakeTx();
    await recordCorrections(tx, { ...base, before: { hallazgos: "a" }, after: { hallazgos: "a" } });
    expect(statements()).toBe(0);
  });
});
