import { describe, expect, it } from "vitest";

import type { db } from "@/shared/db/client";
import { OrderClosedError } from "./order-lock";
import { SYSTEM_SCOPE } from "./scope";
import { OrdenServicioNotFoundError } from "./service";
import type { OrderStatus } from "./transitions";
import { setUrgent } from "./urgent";

/** Answers by statement order; records every `.set(...)`. The tx has no insert/delete, so one would be a TypeError. */
function fakeDb(results: unknown[]) {
  const log = { sets: [] as Record<string, unknown>[], statements: 0 };
  let next = 0;
  const statement = () => {
    const chain: unknown = new Proxy(function () {}, {
      get(_, prop) {
        if (prop === "then") {
          log.statements += 1;
          const result = results[next++] ?? [];
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          if (prop === "set") log.sets.push(args[0] as Record<string, unknown>);
          return chain;
        };
      },
    });
    return chain;
  };
  const tx = { select: statement, update: statement };
  return {
    database: { transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } as unknown as typeof db,
    log,
  };
}

const AT = new Date("2026-10-20T10:00:00Z");
const order = (status: OrderStatus, urgenteAt: Date | null = null) => [{ id: "o1", status, urgenteAt, urgenteBy: urgenteAt ? "u0" : null }];
const deps = (database: typeof db) => ({ scope: SYSTEM_SCOPE, actorId: "u1", db: database });

describe("setUrgent", () => {
  it("sets the flag with the actor and writes ONLY the two urgent columns (never updatedAt)", async () => {
    const { database, log } = fakeDb([order("open"), []]);

    await expect(setUrgent("o1", true, deps(database))).resolves.toEqual({ urgent: true });

    expect(log.sets).toEqual([{ urgenteAt: expect.any(Date), urgenteBy: "u1" }]);
    expect(Object.keys(log.sets[0]).sort()).toEqual(["urgenteAt", "urgenteBy"]);
  });

  it("clears both columns", async () => {
    const { database, log } = fakeDb([order("in_progress", AT), []]);

    await expect(setUrgent("o1", false, deps(database))).resolves.toEqual({ urgent: false });

    expect(log.sets).toEqual([{ urgenteAt: null, urgenteBy: null }]);
  });

  it("is idempotent: setting an urgent order writes nothing, so the first setter stays", async () => {
    const { database, log } = fakeDb([order("open", AT)]);

    await expect(setUrgent("o1", true, deps(database))).resolves.toEqual({ urgent: true });

    expect(log.sets).toEqual([]);
  });

  it("is idempotent: clearing a non-urgent order writes nothing", async () => {
    const { database, log } = fakeDb([order("open")]);

    await expect(setUrgent("o1", false, deps(database))).resolves.toEqual({ urgent: false });

    expect(log.sets).toEqual([]);
  });

  it.each(["done", "cancelled"] as const)("refuses a %s order and writes nothing", async (status) => {
    const { database, log } = fakeDb([order(status, AT)]);

    await expect(setUrgent("o1", false, deps(database))).rejects.toBeInstanceOf(OrderClosedError);

    expect(log.sets).toEqual([]);
  });

  it("is not found when the scope hides the order", async () => {
    const { database } = fakeDb([[]]);

    await expect(setUrgent("o1", true, deps(database))).rejects.toBeInstanceOf(OrdenServicioNotFoundError);
  });
});
