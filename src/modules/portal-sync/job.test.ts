import { describe, expect, it, vi } from "vitest";

import type { IngestBody } from "@portal/contract";
import { decideSync, registerPortalSyncWorker, runPortalSync, type LockedQueries, type SyncState } from "./job";
import { PortalRejectedError } from "./transport";

const CONFIG = { url: "https://portal.example/api/ingest", secret: "s" };
const NOW = new Date("2026-10-07T12:00:00.000Z");

const live: SyncState = {
  deactivatedAt: null,
  portalToken: "tok",
  latestGranted: true,
  vehicles: [],
  orders: [],
};

describe("decideSync", () => {
  const input = { deactivatedAt: null, portalToken: "tok", latestGranted: true as boolean | null };

  it("upserts only when active AND latest consent granted AND a token exists", () => {
    expect(decideSync(input)).toBe("upsert");
    expect(decideSync({ ...input, deactivatedAt: new Date() })).toBe("delete");
    expect(decideSync({ ...input, latestGranted: false })).toBe("delete");
    expect(decideSync({ ...input, portalToken: null })).toBe("delete");
  });

  it("never pushes anything for a customer who never consented", () => {
    expect(decideSync({ ...input, latestGranted: null })).toBe("skip");
  });
});

function harness(state: SyncState | null, nextVersion = 41) {
  const send = vi.fn<(body: IngestBody) => Promise<void>>(async () => {});
  const order: string[] = [];
  const withLock = vi.fn(async (_id: string, fn: (q: LockedQueries) => Promise<void>) => {
    order.push("lock");
    await fn({
      readState: async () => (order.push("read"), state),
      nextVersion: async () => (order.push("nextval"), nextVersion),
    });
  });
  return { send, withLock, order };
}

describe("runPortalSync", () => {
  it("sends nothing and does no database work when the portal is not configured", async () => {
    for (const config of [{}, { url: CONFIG.url }, { secret: "s" }]) {
      const h = harness(live);
      await runPortalSync("c1", { config, withLock: h.withLock, send: h.send, now: () => NOW });
      expect(h.withLock).not.toHaveBeenCalled();
      expect(h.send).not.toHaveBeenCalled();
    }
  });

  it("upserts a live customer, holding the lock across read, version and send", async () => {
    const h = harness(live, 41);
    h.send.mockImplementation(async () => void h.order.push("send"));
    await runPortalSync("c1", { config: CONFIG, withLock: h.withLock, send: h.send, now: () => NOW });
    expect(h.order).toEqual(["lock", "read", "nextval", "send"]);
    expect(h.send.mock.calls[0][0]).toMatchObject({ kind: "upsert", clienteId: "c1", version: 41 });
  });

  it("decides at run time: consent revoked after enqueue pushes a delete, never a snapshot", async () => {
    const h = harness({ ...live, latestGranted: false }, 42);
    await runPortalSync("c1", { config: CONFIG, withLock: h.withLock, send: h.send, now: () => NOW });
    expect(h.send).toHaveBeenCalledOnce();
    expect(h.send.mock.calls[0][0]).toEqual({ kind: "delete", clienteId: "c1", version: 42 });
  });

  it("restores the same token on reactivation", async () => {
    const h = harness({ ...live, deactivatedAt: null, portalToken: "same-token" });
    await runPortalSync("c1", { config: CONFIG, withLock: h.withLock, send: h.send, now: () => NOW });
    const body = h.send.mock.calls[0][0];
    expect(body.kind === "upsert" && body.tokenHash).toBe((await import("./snapshot")).hashToken("same-token"));
  });

  it("pushes nothing for a customer who never consented, and draws no version", async () => {
    const h = harness({ ...live, latestGranted: null });
    await runPortalSync("c1", { config: CONFIG, withLock: h.withLock, send: h.send, now: () => NOW });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.order).not.toContain("nextval");
  });

  it("pushes nothing for a customer that does not exist", async () => {
    const h = harness(null);
    await runPortalSync("c1", { config: CONFIG, withLock: h.withLock, send: h.send, now: () => NOW });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("lets a send failure propagate so pg-boss retries", async () => {
    const h = harness(live);
    h.send.mockRejectedValue(new Error("503"));
    await expect(runPortalSync("c1", { config: CONFIG, withLock: h.withLock, send: h.send, now: () => NOW })).rejects.toThrow("503");
  });
});

describe("registerPortalSyncWorker", () => {
  async function register(run: (id: string) => Promise<void>) {
    const createQueue = vi.fn(async () => {});
    let handler!: (jobs: { id: string; data: unknown }[]) => Promise<void>;
    const work = vi.fn(async (_name: string, _opts: unknown, h: typeof handler) => void (handler = h));
    await registerPortalSyncWorker({ getBoss: async () => ({ createQueue, work }) as never, run });
    return { createQueue, work, fire: () => handler([{ id: "job-1", data: { clienteId: "c1" } }]) };
  }

  it("creates the DLQ first, then the queue with retry 5, 60 s backoff and that DLQ", async () => {
    const { createQueue } = await register(async () => {});
    expect(createQueue.mock.calls).toEqual([
      ["portal-sync-dlq"],
      ["portal-sync", { retryLimit: 5, retryDelay: 60, retryBackoff: true, deadLetter: "portal-sync-dlq" }],
    ]);
  });

  it("passes only the clienteId to the run", async () => {
    const run = vi.fn(async () => {});
    const { fire } = await register(run);
    await fire();
    expect(run).toHaveBeenCalledWith("c1");
  });

  it("rethrows a retryable failure so pg-boss retries and dead-letters it", async () => {
    const { fire } = await register(async () => {
      throw new Error("portal answered 503");
    });
    await expect(fire()).rejects.toThrow("503");
  });

  it("completes the job on a PortalRejectedError instead of burning retries", async () => {
    const { fire } = await register(async () => {
      throw new PortalRejectedError("portal answered 400");
    });
    await expect(fire()).resolves.toBeUndefined();
  });
});
