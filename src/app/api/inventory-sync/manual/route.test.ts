import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { SyncAlreadyRunningError } from "@/modules/inventory-sync/job";
import { GET, handleManualSyncStatus, handleManualSyncTrigger, POST } from "./route";

function requestAs(role: "usuario" | "administrador", method: "GET" | "POST" = "GET") {
  return new NextRequest("http://localhost/api/inventory-sync/manual", {
    method,
    headers: { "x-user-id": "user-1", "x-user-role": role },
  });
}

/** R9.6/NFR-8 — "sync.manual" is one of the three explicit `can()`-gated actions. */
describe("inventory-sync manual route — role gating (403)", () => {
  it("GET rejects a non-admin (usuario) with 403", async () => {
    const response = await GET(requestAs("usuario"));
    expect(response.status).toBe(403);
  });

  it("POST rejects a non-admin (usuario) with 403", async () => {
    const response = await POST(requestAs("usuario", "POST"));
    expect(response.status).toBe(403);
  });

  it("throws when called without session headers (proxy.ts did not validate)", async () => {
    const request = new NextRequest("http://localhost/api/inventory-sync/manual");
    await expect(GET(request)).rejects.toThrow();
  });
});

describe("POST /api/inventory-sync/manual — R2.1/2.5", () => {
  it("starts a sync as an admin and returns 202 when none is running", async () => {
    const requestManualSync = vi.fn().mockResolvedValue(undefined);

    const response = await handleManualSyncTrigger(requestAs("administrador", "POST"), { requestManualSync });

    expect(response.status).toBe(202);
    expect(requestManualSync).toHaveBeenCalledWith("user-1");
  });

  it("rejects a concurrent request with 409 and the 'already running' message (R2.5 — previously unreachable)", async () => {
    const requestManualSync = vi.fn().mockRejectedValue(new SyncAlreadyRunningError());

    const response = await handleManualSyncTrigger(requestAs("administrador", "POST"), { requestManualSync });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/already in progress/i);
  });
});

describe("GET /api/inventory-sync/manual — R2.2/2.4 status polling", () => {
  it("reports running=true while a sync is in flight", async () => {
    const response = await handleManualSyncStatus(requestAs("administrador"), {
      hasActiveSyncRun: async () => true,
      getLatestSyncRun: async () => null,
    });

    expect(await response.json()).toEqual({ running: true, lastRun: null });
  });

  it("reports the last completed run's count + timestamp once finished", async () => {
    const finishedAt = new Date("2026-07-22T00:00:00Z");
    const response = await handleManualSyncStatus(requestAs("administrador"), {
      hasActiveSyncRun: async () => false,
      getLatestSyncRun: async () => ({
        id: "run-1",
        startedAt: finishedAt,
        finishedAt,
        status: "completed",
        productCount: 42,
        error: null,
      }),
    });

    const body = await response.json();
    expect(body.running).toBe(false);
    expect(body.lastRun.productCount).toBe(42);
  });
});
