import { describe, expect, it, vi } from "vitest";

const enqueuePortalSync = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/modules/portal-sync/enqueue", () => ({ enqueuePortalSync }));

import type { Tx } from "./order-lock";
import { applyReadiness } from "./readiness";
import type { OrderStatus } from "./transitions";

/**
 * Answers the one assignments SELECT with `rows`; records every `.set(...)`. An
 * UPDATE is the only other statement `applyReadiness` may issue, so `sets` is
 * the whole write log.
 */
function fakeTx(rows: unknown[]) {
  const log = { sets: [] as { status?: string; updatedAt?: unknown }[], selects: 0 };
  const chain = (result: unknown): unknown =>
    new Proxy(function () {}, {
      get(_, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          if (prop === "set") log.sets.push(args[0] as never);
          return chain(result);
        };
      },
    });
  const tx = {
    select: () => {
      log.selects += 1;
      return chain(rows);
    },
    update: () => chain([]),
  };
  return { tx: tx as unknown as Tx, log };
}

const MARK = new Date("2026-10-06T10:00:00Z");
const marked = { parteListaAt: MARK, deactivatedAt: null };
const pending = { parteListaAt: null, deactivatedAt: null };
const offUnmarked = { parteListaAt: null, deactivatedAt: new Date("2026-09-01") };
const order = (status: OrderStatus) => ({ id: "o1", status });

describe("applyReadiness truth table", () => {
  it("never makes an order with zero assignees ready", async () => {
    const { tx, log } = fakeTx([]);
    await expect(applyReadiness(tx, order("in_progress"))).resolves.toBe("in_progress");
    expect(log.sets).toEqual([]);
  });

  it("never makes an order whose only assignee is deactivated ready", async () => {
    const { tx, log } = fakeTx([{ parteListaAt: MARK, deactivatedAt: new Date("2026-09-01") }]);
    await expect(applyReadiness(tx, order("in_progress"))).resolves.toBe("in_progress");
    expect(log.sets).toEqual([]);
  });

  it("moves an in_progress order to ready_for_review, with a timestamp, once every active assignee has marked", async () => {
    const { tx, log } = fakeTx([marked, marked]);
    await expect(applyReadiness(tx, order("in_progress"))).resolves.toBe("ready_for_review");
    expect(log.sets).toEqual([{ status: "ready_for_review", updatedAt: expect.any(Date) }]);
  });

  it("leaves an in_progress order alone while one active assignee is pending", async () => {
    const { tx, log } = fakeTx([marked, pending]);
    await expect(applyReadiness(tx, order("in_progress"))).resolves.toBe("in_progress");
    expect(log.sets).toEqual([]);
  });

  it("ignores a deactivated assignee who never marked", async () => {
    const { tx } = fakeTx([marked, offUnmarked]);
    await expect(applyReadiness(tx, order("in_progress"))).resolves.toBe("ready_for_review");
  });

  it("returns a ready_for_review order to in_progress when a mark is removed", async () => {
    const { tx, log } = fakeTx([marked, pending]);
    await expect(applyReadiness(tx, order("ready_for_review"))).resolves.toBe("in_progress");
    expect(log.sets).toEqual([{ status: "in_progress", updatedAt: expect.any(Date) }]);
  });

  it("keeps a ready_for_review order ready while every active assignee is still marked, writing nothing", async () => {
    const { tx, log } = fakeTx([marked, marked]);
    await expect(applyReadiness(tx, order("ready_for_review"))).resolves.toBe("ready_for_review");
    expect(log.sets).toEqual([]);
  });

  it.each<OrderStatus>(["open", "done", "cancelled"])("does nothing on a %s order, not even a read", async (status) => {
    const { tx, log } = fakeTx([marked]);
    await expect(applyReadiness(tx, order(status))).resolves.toBe(status);
    expect(log.selects).toBe(0);
    expect(log.sets).toEqual([]);
  });
});

describe("applyReadiness and the customer portal (WU5b)", () => {
  it("never enqueues a portal sync: in_progress and ready_for_review both read 'En proceso'", async () => {
    const { tx, log } = fakeTx([marked]);
    await expect(applyReadiness(tx, order("in_progress"))).resolves.toBe("ready_for_review");
    expect(log.sets).toHaveLength(1); // the status really flipped, so the absence below is not vacuous
    expect(enqueuePortalSync).not.toHaveBeenCalled();
  });
});
