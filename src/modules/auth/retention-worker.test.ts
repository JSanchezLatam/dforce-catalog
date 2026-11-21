import { describe, expect, it, vi } from "vitest";

import { registerLoginAttemptsRetention } from "./retention-worker";

describe("registerLoginAttemptsRetention", () => {
  async function register(purge: () => Promise<number> = async () => 0, purgeTrustedDevices: () => Promise<number> = async () => 0) {
    const createQueue = vi.fn(async () => {});
    const schedule = vi.fn(async () => {});
    const handlers = new Map<string, (jobs: { id: string; data: unknown }[]) => Promise<void>>();
    const work = vi.fn(async (name: string, _o: unknown, h: never) => void handlers.set(name, h));
    await registerLoginAttemptsRetention({ getBoss: async () => ({ createQueue, schedule, work }) as never, purge, purgeTrustedDevices });
    return { createQueue, schedule, work, handlers };
  }

  it("schedules the retention daily at 03:40 in America/Panama, before its worker", async () => {
    const { createQueue, schedule, work } = await register();

    expect(createQueue).toHaveBeenCalledWith("login-attempts-retention");
    expect(schedule).toHaveBeenCalledWith("login-attempts-retention", "40 3 * * *", {}, { tz: "America/Panama" });
    expect(work).toHaveBeenCalledWith("login-attempts-retention", { localConcurrency: 1 }, expect.any(Function));
    expect(schedule.mock.invocationCallOrder[0]).toBeLessThan(work.mock.invocationCallOrder[0]);
  });

  it("purges from its job", async () => {
    const purge = vi.fn(async () => 3);
    const { handlers } = await register(purge);

    await handlers.get("login-attempts-retention")!([{ id: "job-1", data: {} }]);

    expect(purge).toHaveBeenCalledOnce();
  });

  it("also deletes the expired trusted devices from the same run", async () => {
    const purgeTrustedDevices = vi.fn(async () => 2);
    const { handlers } = await register(undefined, purgeTrustedDevices);

    await handlers.get("login-attempts-retention")!([{ id: "job-1", data: {} }]);

    expect(purgeTrustedDevices).toHaveBeenCalledOnce();
  });
});
