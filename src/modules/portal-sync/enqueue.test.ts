import { describe, expect, it, vi } from "vitest";

import { enqueuePortalSync } from "./enqueue";

const CONFIG = { url: "https://portal.example/api/ingest", secret: "s" };

function fakeBoss(send = vi.fn(async () => "job-id" as string | null)) {
  const createQueue = vi.fn(async () => {});
  return { boss: { createQueue, send }, createQueue, send };
}

describe("enqueuePortalSync", () => {
  it("creates the DLQ first, then the queue with retry 5, 60 s backoff, that DLQ and the short policy", async () => {
    const { boss, createQueue } = fakeBoss();
    await enqueuePortalSync("c1", { config: CONFIG, getBoss: async () => boss as never });
    expect(createQueue.mock.calls).toEqual([
      ["portal-sync-dlq"],
      ["portal-sync", { retryLimit: 5, retryDelay: 60, retryBackoff: true, deadLetter: "portal-sync-dlq", policy: "short" }],
    ]);
  });

  it("sends only the clienteId, singleton per customer so a burst yields one queued job", async () => {
    const { boss, send } = fakeBoss();
    await enqueuePortalSync("c1", { config: CONFIG, getBoss: async () => boss as never });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith("portal-sync", { clienteId: "c1" }, { singletonKey: "c1" });
  });

  it("is a no-op, touching no queue, when the portal is not configured", async () => {
    for (const config of [{}, { url: CONFIG.url }, { secret: "s" }]) {
      const getBoss = vi.fn();
      await enqueuePortalSync("c1", { config, getBoss: getBoss as never });
      expect(getBoss).not.toHaveBeenCalled();
    }
  });

  it("captures an enqueue failure instead of throwing it", async () => {
    const boom = new Error("queue down");
    const report = vi.fn();
    await expect(
      enqueuePortalSync("c1", {
        config: CONFIG,
        getBoss: async () => {
          throw boom;
        },
        report,
      }),
    ).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith(boom, { tags: { job: "portal-sync", phase: "enqueue" } });
  });

  it("does not throw even when the failure report itself throws", async () => {
    await expect(
      enqueuePortalSync("c1", {
        config: CONFIG,
        getBoss: async () => {
          throw new Error("queue down");
        },
        report: () => {
          throw new Error("sentry down");
        },
      }),
    ).resolves.toBeUndefined();
  });
});
