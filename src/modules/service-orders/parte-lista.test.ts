import { describe, expect, it } from "vitest";

import type { db } from "@/shared/db/client";
import { markParteLista, ParteListaForbiddenError, ParteListaRefusedError, unmarkParteLista } from "./parte-lista";
import { OrderClosedError, OrderEditForbiddenError } from "./order-lock";
import { SYSTEM_SCOPE } from "./scope";
import { OrdenServicioNotFoundError } from "./service";
import type { OrderStatus } from "./transitions";

/**
 * Answers by statement order, as `work-lines.test.ts` does: the Nth awaited
 * statement gets the Nth queued result. Records every `.set(...)`; the tx has
 * no `delete` or `insert`, so either would be a TypeError here.
 */
function fakeDb(results: unknown[]) {
  const log = { sets: [] as { parteListaAt?: unknown; status?: string }[], statements: 0 };
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
          if (prop === "set") log.sets.push(args[0] as never);
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

const order = (status: OrderStatus) => [{ id: "o1", status }];
const OWN = [{ id: "t1" }]; // the caller's roster row
const PENDING = [{ parteListaAt: null }];
const MARKED = [{ parteListaAt: new Date("2026-10-06") }];
const active = (marked: boolean) => ({ parteListaAt: marked ? new Date("2026-10-06") : null, deactivatedAt: null });
const input = { ordenId: "o1", userId: "user-t", scope: SYSTEM_SCOPE };

describe("markParteLista", () => {
  it("sets the caller's own mark and, when it was the last one, returns ready_for_review", async () => {
    const { database, log } = fakeDb([order("in_progress"), OWN, PENDING, [], [active(true), active(true)], []]);

    await expect(markParteLista(input, { db: database })).resolves.toEqual({ status: "ready_for_review" });

    expect(log.sets[0]).toEqual({ parteListaAt: expect.any(Date) });
    expect(log.sets[1]).toMatchObject({ status: "ready_for_review" });
  });

  it("leaves the order in_progress while another active assignee is pending", async () => {
    const { database, log } = fakeDb([order("in_progress"), OWN, PENDING, [], [active(true), active(false)]]);

    await expect(markParteLista(input, { db: database })).resolves.toEqual({ status: "in_progress" });

    expect(log.sets).toHaveLength(1);
  });

  it("requires no work line: it never reads one", async () => {
    // order, roster row, assignment, update, readiness read: five statements, none of them lines
    const { database, log } = fakeDb([order("in_progress"), OWN, PENDING, [], [active(false)]]);
    await markParteLista(input, { db: database });
    expect(log.statements).toBe(5);
  });

  it("refuses a técnico naming another technician's assignment (403) and writes nothing", async () => {
    const { database, log } = fakeDb([order("in_progress"), OWN, PENDING]);

    const err = await markParteLista({ ...input, tecnicoId: "t2" }, { db: database }).catch((e) => e);

    expect(err).toBeInstanceOf(ParteListaForbiddenError);
    expect(err.message).toBe("Solo podés marcar tu propia parte");
    expect(log.sets).toEqual([]);
  });

  it("refuses a caller with no roster row, or one who is not assigned, as forbidden", async () => {
    const noRow = fakeDb([order("in_progress"), []]);
    await expect(markParteLista(input, { db: noRow.database })).rejects.toBeInstanceOf(ParteListaForbiddenError);
    const unassigned = fakeDb([order("in_progress"), OWN, []]);
    await expect(markParteLista(input, { db: unassigned.database })).rejects.toBeInstanceOf(ParteListaForbiddenError);
    expect(noRow.log.sets).toEqual([]);
    expect(unassigned.log.sets).toEqual([]);
  });

  it("refuses an already-marked part with a Spanish message and writes nothing", async () => {
    const { database, log } = fakeDb([order("in_progress"), OWN, MARKED]);

    const err = await markParteLista(input, { db: database }).catch((e) => e);

    expect(err).toBeInstanceOf(ParteListaRefusedError);
    expect(err.message).toBe("Tu parte ya está marcada como lista");
    expect(log.sets).toEqual([]);
  });

  it.each<OrderStatus>(["open", "ready_for_review"])("refuses marking on a %s order, writing nothing", async (status) => {
    const { database, log } = fakeDb([order(status)]);
    await expect(markParteLista(input, { db: database })).rejects.toBeInstanceOf(OrderEditForbiddenError);
    expect(log.sets).toEqual([]);
  });

  it.each<OrderStatus>(["done", "cancelled"])("refuses a %s order with OrderClosedError: it never takes a correction", async (status) => {
    const { database, log } = fakeDb([order(status)]);
    await expect(markParteLista(input, { db: database })).rejects.toBeInstanceOf(OrderClosedError);
    expect(log.sets).toEqual([]);
  });

  it("answers an order the scope cannot see as not found", async () => {
    const { database } = fakeDb([[]]);
    await expect(markParteLista(input, { db: database })).rejects.toBeInstanceOf(OrdenServicioNotFoundError);
  });
});

describe("unmarkParteLista", () => {
  it("clears the mark and returns a ready_for_review order to in_progress", async () => {
    const { database, log } = fakeDb([order("ready_for_review"), OWN, MARKED, [], [active(false), active(true)], []]);

    await expect(unmarkParteLista(input, { db: database })).resolves.toEqual({ status: "in_progress" });

    expect(log.sets[0]).toEqual({ parteListaAt: null });
    expect(log.sets[1]).toMatchObject({ status: "in_progress" });
  });

  it("clears the mark on an in_progress order without a status write", async () => {
    const { database, log } = fakeDb([order("in_progress"), OWN, MARKED, [], [active(false), active(true)]]);

    await expect(unmarkParteLista(input, { db: database })).resolves.toEqual({ status: "in_progress" });

    expect(log.sets).toEqual([{ parteListaAt: null }]);
  });

  it("refuses un-marking a part that is not marked", async () => {
    const { database, log } = fakeDb([order("in_progress"), OWN, PENDING]);
    const err = await unmarkParteLista(input, { db: database }).catch((e) => e);
    expect(err).toBeInstanceOf(ParteListaRefusedError);
    expect(err.message).toBe("Tu parte no está marcada como lista");
    expect(log.sets).toEqual([]);
  });

  it("refuses naming another technician's assignment", async () => {
    const { database } = fakeDb([order("ready_for_review"), OWN, MARKED]);
    await expect(unmarkParteLista({ ...input, tecnicoId: "t2" }, { db: database })).rejects.toBeInstanceOf(ParteListaForbiddenError);
  });

  it.each<OrderStatus>(["done", "cancelled"])("refuses a %s order with OrderClosedError", async (status) => {
    const { database } = fakeDb([order(status)]);
    await expect(unmarkParteLista(input, { db: database })).rejects.toBeInstanceOf(OrderClosedError);
  });

  it("refuses an open order", async () => {
    const { database } = fakeDb([order("open")]);
    await expect(unmarkParteLista(input, { db: database })).rejects.toBeInstanceOf(OrderEditForbiddenError);
  });
});
