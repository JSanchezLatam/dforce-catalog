import { describe, expect, it } from "vitest";

import type { db } from "@/shared/db/client";
import * as assignments from "./assignments";
import { assignTecnico, InvalidTecnicoError } from "./assignments";
import { OrderClosedError } from "./order-lock";
import { SYSTEM_SCOPE } from "./scope";
import { OrdenServicioNotFoundError } from "./service";
import type { OrderStatus } from "./transitions";

/**
 * Answers by statement order, as `order-lock.test.ts` does: the Nth awaited
 * statement gets the Nth queued result. Records every `.values(...)`,
 * `.set(...)` and `.onConflictDoNothing()`. The tx has NO `delete`, so a
 * delete path would be a TypeError here.
 */
function fakeDb(results: unknown[][]) {
  const log = { values: [] as unknown[], sets: [] as unknown[], conflict: 0, statements: 0 };
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
          if (prop === "values") log.values.push(args[0]);
          if (prop === "set") log.sets.push(args[0]);
          if (prop === "onConflictDoNothing") log.conflict += 1;
          return chain;
        };
      },
    });
    return chain;
  };
  const tx = { select: statement, insert: statement, update: statement };
  return {
    database: { transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } as unknown as typeof db,
    log,
  };
}

const order = (status: OrderStatus) => [{ id: "o1", status }];
const ACTIVE = [{ id: "t1", deactivatedAt: null }];
const input = { ordenId: "o1", tecnicoId: "t1", assignedBy: "admin-1", scope: SYSTEM_SCOPE };
const NEW_ROW = [{ tecnicoId: "t1" }];

describe("assignTecnico", () => {
  it.each<OrderStatus>(["open", "in_progress"])(
    "inserts the assignment on a %s order and leaves its status alone",
    async (status) => {
      const { database, log } = fakeDb([order(status), ACTIVE, NEW_ROW]);

      await expect(assignTecnico(input, { db: database })).resolves.toEqual({ created: true });

      // no `parteListaAt` key: the mark starts null
      expect(log.values).toEqual([{ ordenId: "o1", tecnicoId: "t1", assignedBy: "admin-1" }]);
      expect(log.sets).toEqual([]);
    },
  );

  it("returns a ready_for_review order to in_progress when the assignment is new", async () => {
    const { database, log } = fakeDb([order("ready_for_review"), ACTIVE, NEW_ROW, []]);

    await assignTecnico(input, { db: database });

    expect(log.sets).toEqual([{ status: "in_progress" }]);
  });

  it("is a no-op for a technician already assigned: no error, and a ready_for_review order stays ready", async () => {
    const { database, log } = fakeDb([order("ready_for_review"), ACTIVE, []]);

    await expect(assignTecnico(input, { db: database })).resolves.toEqual({ created: false });

    expect(log.conflict).toBe(1);
    expect(log.sets).toEqual([]);
  });

  it.each<OrderStatus>(["done", "cancelled"])(
    "refuses a %s order with OrderClosedError and writes nothing (it never takes a correction)",
    async (status) => {
      const { database, log } = fakeDb([order(status), ACTIVE, NEW_ROW]);

      await expect(assignTecnico(input, { db: database })).rejects.toBeInstanceOf(OrderClosedError);

      expect(log.values).toEqual([]);
      expect(log.statements).toBe(1);
    },
  );

  it("refuses a deactivated technician and writes nothing", async () => {
    const { database, log } = fakeDb([order("open"), [{ id: "t1", deactivatedAt: new Date("2026-09-01") }]]);

    await expect(assignTecnico(input, { db: database })).rejects.toBeInstanceOf(InvalidTecnicoError);

    expect(log.values).toEqual([]);
  });

  it("refuses an unknown technician", async () => {
    const { database } = fakeDb([order("open"), []]);
    await expect(assignTecnico(input, { db: database })).rejects.toBeInstanceOf(InvalidTecnicoError);
  });

  it("answers an order the scope cannot see (or that does not exist) as not found", async () => {
    const { database } = fakeDb([[]]);
    await expect(assignTecnico(input, { db: database })).rejects.toBeInstanceOf(OrdenServicioNotFoundError);
  });

  it("offers no way to remove an assignment", () => {
    expect(Object.keys(assignments).filter((name) => /delete|remove|unassign|revoke/i.test(name))).toEqual([]);
  });
});
