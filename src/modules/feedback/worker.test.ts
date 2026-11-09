import { describe, expect, it, vi } from "vitest";

import { registerFeedbackWorkers, runFeedbackSweep, SWEEP_BATCH, type RunFeedbackSweepDeps } from "./worker";

const CONFIG = { url: "https://portal.example/api/ingest", secret: "s" };

describe("runFeedbackSweep", () => {
  it("returns before querying when the portal is unconfigured", async () => {
    const selectDue = vi.fn<NonNullable<RunFeedbackSweepDeps["selectDue"]>>(async () => ["a"]);
    const send = vi.fn(async () => null);
    await runFeedbackSweep({ config: { url: "https://p.example" }, selectDue, send });
    await runFeedbackSweep({ config: {}, selectDue, send });
    expect(selectDue).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("asks for at most 25 due rows and enqueues one job per row with singletonKey and no retry", async () => {
    const selectDue = vi.fn<NonNullable<RunFeedbackSweepDeps["selectDue"]>>(async () => ["a", "b", "c"]);
    const send = vi.fn<NonNullable<RunFeedbackSweepDeps["send"]>>(async () => null);
    await runFeedbackSweep({ config: CONFIG, selectDue, send });
    expect(SWEEP_BATCH).toBe(25);
    expect(selectDue).toHaveBeenCalledWith(25);
    expect(send.mock.calls).toEqual([
      ["feedback-deliver", { id: "a" }, { singletonKey: "a", retryLimit: 0 }],
      ["feedback-deliver", { id: "b" }, { singletonKey: "b", retryLimit: 0 }],
      ["feedback-deliver", { id: "c" }, { singletonKey: "c", retryLimit: 0 }],
    ]);
  });
});

describe("registerFeedbackWorkers", () => {
  async function register(over: { sweep?: () => Promise<void>; deliver?: (id: string) => Promise<unknown> } = {}) {
    const createQueue = vi.fn(async () => {});
    const schedule = vi.fn(async () => {});
    const handlers = new Map<string, (jobs: { id: string; data: unknown }[]) => Promise<void>>();
    const work = vi.fn(async (name: string, _o: unknown, h: never) => void handlers.set(name, h));
    await registerFeedbackWorkers({
      getBoss: async () => ({ createQueue, schedule, work }) as never,
      sweep: over.sweep ?? (async () => {}),
      deliver: (over.deliver ?? (async () => "delivered")) as never,
    });
    return { createQueue, schedule, work, handlers };
  }

  it("creates both queues, schedules every minute in America/Panama, before the workers", async () => {
    const { createQueue, schedule, work } = await register();
    expect(createQueue).toHaveBeenCalledWith("feedback-deliver", { policy: "short", retryLimit: 0 });
    expect(createQueue).toHaveBeenCalledWith("feedback-sweep");
    expect(schedule).toHaveBeenCalledWith("feedback-sweep", "* * * * *", {}, { tz: "America/Panama" });
    expect(schedule.mock.invocationCallOrder[0]).toBeLessThan(work.mock.invocationCallOrder[0]);
  });

  it("runs the deliver worker with localConcurrency 1", async () => {
    const { work } = await register();
    expect(work).toHaveBeenCalledWith("feedback-deliver", { localConcurrency: 1 }, expect.any(Function));
    expect(work).toHaveBeenCalledWith("feedback-sweep", expect.anything(), expect.any(Function));
  });

  it("delivers the id the job carries, with the default timeout", async () => {
    const deliver = vi.fn<(id: string) => Promise<string>>(async () => "queued");
    const { handlers } = await register({ deliver });
    await handlers.get("feedback-deliver")!([{ id: "job-1", data: { id: "fb-9" } }]);
    expect(deliver).toHaveBeenCalledWith("fb-9");
  });

  it("runs the sweep from its job", async () => {
    const sweep = vi.fn(async () => {});
    const { handlers } = await register({ sweep });
    await handlers.get("feedback-sweep")!([{ id: "job-2", data: {} }]);
    expect(sweep).toHaveBeenCalledOnce();
  });
});
