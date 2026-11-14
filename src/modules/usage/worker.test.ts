import { describe, expect, it, vi } from "vitest";

import { registerUsageDelivery } from "./worker";

describe("registerUsageDelivery", () => {
  async function register(deliver: () => Promise<unknown> = async () => 0) {
    const createQueue = vi.fn(async () => {});
    const schedule = vi.fn(async () => {});
    const handlers = new Map<string, (jobs: { id: string; data: unknown }[]) => Promise<void>>();
    const work = vi.fn(async (name: string, _o: unknown, h: never) => void handlers.set(name, h));
    await registerUsageDelivery({ getBoss: async () => ({ createQueue, schedule, work }) as never, deliver });
    return { createQueue, schedule, work, handlers };
  }

  it("schedules usage-deliver hourly at minute 17 in America/Panama, before its worker", async () => {
    const { createQueue, schedule, work } = await register();
    expect(createQueue).toHaveBeenCalledWith("usage-deliver");
    expect(schedule).toHaveBeenCalledWith("usage-deliver", "17 * * * *", {}, { tz: "America/Panama" });
    expect(work).toHaveBeenCalledWith("usage-deliver", { localConcurrency: 1 }, expect.any(Function));
    expect(schedule.mock.invocationCallOrder[0]).toBeLessThan(work.mock.invocationCallOrder[0]);
  });

  it("runs the delivery from its job", async () => {
    const deliver = vi.fn(async () => 2);
    const { handlers } = await register(deliver);
    await handlers.get("usage-deliver")!([{ id: "job-1", data: {} }]);
    expect(deliver).toHaveBeenCalledOnce();
  });
});
