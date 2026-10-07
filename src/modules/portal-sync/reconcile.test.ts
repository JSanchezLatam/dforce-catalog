import { describe, expect, it, vi } from "vitest";

import type { IngestBody } from "@portal/contract";
import { registerPortalReconcile, runPortalReconcile, type ReconcileQueries } from "./reconcile";
import { PortalRejectedError } from "./transport";

const CONFIG = { url: "https://portal.example/api/ingest", secret: "s" };

function harness(opts: { consented?: string[]; live?: string[]; version?: number } = {}) {
  const order: string[] = [];
  const queries: ReconcileQueries = {
    drawVersion: async () => (order.push("version"), opts.version ?? 500),
    consentedIds: async () => (order.push("consented"), opts.consented ?? ["a", "b", "c"]),
    liveIds: async () => (order.push("live"), opts.live ?? ["a"]),
  };
  const enqueue = vi.fn(async (id: string) => void order.push(`enqueue:${id}`));
  const send = vi.fn<(body: IngestBody) => Promise<void>>(async () => void order.push("send"));
  return { queries, enqueue, send, order };
}

describe("runPortalReconcile", () => {
  it("does nothing, and reads nothing, when the portal is not configured", async () => {
    for (const config of [{}, { url: CONFIG.url }, { secret: "s" }]) {
      const h = harness();
      await runPortalReconcile({ config, queries: h.queries, enqueue: h.enqueue, send: h.send });
      expect(h.order).toEqual([]);
    }
  });

  it("enqueues every customer with any consent ever, so a lost enqueue heals and a lost delete is repeated", async () => {
    const h = harness({ consented: ["a", "b", "c"], live: ["a"] });
    await runPortalReconcile({ config: CONFIG, queries: h.queries, enqueue: h.enqueue, send: h.send });
    expect(h.enqueue.mock.calls.map(([id]) => id)).toEqual(["a", "b", "c"]);
  });

  it("then sends one reconcile carrying exactly the live ids and the drawn version", async () => {
    const h = harness({ live: ["a", "z"], version: 777 });
    await runPortalReconcile({ config: CONFIG, queries: h.queries, enqueue: h.enqueue, send: h.send });
    expect(h.send).toHaveBeenCalledOnce();
    expect(h.send.mock.calls[0][0]).toEqual({ kind: "reconcile", liveClienteIds: ["a", "z"], maxVersion: 777 });
  });

  it("draws the version BEFORE reading the live set, and sends after the enqueues", async () => {
    // Drawn after the read, a customer who became live in between would carry a version below the
    // bound and not be in the set, so the purge would delete a live customer.
    const h = harness({ consented: ["a"], live: ["a"] });
    await runPortalReconcile({ config: CONFIG, queries: h.queries, enqueue: h.enqueue, send: h.send });
    expect(h.order.indexOf("version")).toBeLessThan(h.order.indexOf("live"));
    expect(h.order.at(-1)).toBe("send");
    expect(h.order.indexOf("enqueue:a")).toBeLessThan(h.order.indexOf("send"));
  });

  it("lets a send failure propagate so pg-boss retries the night's reconcile", async () => {
    const h = harness();
    h.send.mockRejectedValue(new Error("503"));
    await expect(runPortalReconcile({ config: CONFIG, queries: h.queries, enqueue: h.enqueue, send: h.send })).rejects.toThrow("503");
  });
});

describe("registerPortalReconcile", () => {
  async function register(run: () => Promise<void>) {
    const createQueue = vi.fn(async () => {});
    const schedule = vi.fn(async () => {});
    let handler!: (jobs: { id: string; data: unknown }[]) => Promise<void>;
    const work = vi.fn(async (_n: string, _o: unknown, h: typeof handler) => void (handler = h));
    await registerPortalReconcile({ getBoss: async () => ({ createQueue, schedule, work }) as never, run });
    return { createQueue, schedule, work, fire: () => handler([{ id: "job-1", data: {} }]) };
  }

  it("creates the queue and schedules 03:00 America/Panama, before the worker", async () => {
    const { createQueue, schedule, work } = await register(async () => {});
    expect(createQueue).toHaveBeenCalledWith("portal-reconcile", { retryLimit: 3, retryDelay: 300, retryBackoff: true });
    expect(schedule).toHaveBeenCalledWith("portal-reconcile", "0 3 * * *", {}, { tz: "America/Panama" });
    expect(work).toHaveBeenCalledWith("portal-reconcile", { localConcurrency: 1 }, expect.any(Function));
    expect(schedule.mock.invocationCallOrder[0]).toBeLessThan(work.mock.invocationCallOrder[0]);
  });

  it("rethrows a retryable failure and completes on a PortalRejectedError", async () => {
    const retry = await register(async () => {
      throw new Error("503");
    });
    await expect(retry.fire()).rejects.toThrow("503");
    const rejected = await register(async () => {
      throw new PortalRejectedError("400");
    });
    await expect(rejected.fire()).resolves.toBeUndefined();
  });
});
