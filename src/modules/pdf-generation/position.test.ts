import { describe, expect, it } from "vitest";

import { deriveQueuePosition, type QueueJobRef } from "./position";

function job(id: string, state: QueueJobRef["state"], createdOn: string): QueueJobRef {
  return { id, state, createdOn: new Date(createdOn) };
}

describe("deriveQueuePosition — Risk-3 (R12.3/12.4)", () => {
  it("returns 0 for the active job (0 jobs ahead)", () => {
    const jobs = [job("active-1", "active", "2026-01-01T00:00:00Z"), job("wait-1", "created", "2026-01-01T00:01:00Z")];
    expect(deriveQueuePosition(jobs, "active-1")).toBe(0);
  });

  it("returns 1 for the first waiter (1 job ahead: the active one)", () => {
    const jobs = [job("active-1", "active", "2026-01-01T00:00:00Z"), job("wait-1", "created", "2026-01-01T00:01:00Z")];
    expect(deriveQueuePosition(jobs, "wait-1")).toBe(1);
  });

  it("matches the spec scenario: a 3rd user's request queues at position 2, then moves to 1 when the job ahead finishes", () => {
    const jobs = [
      job("active-1", "active", "2026-01-01T00:00:00Z"),
      job("wait-1", "created", "2026-01-01T00:01:00Z"),
      job("wait-2", "created", "2026-01-01T00:02:00Z"),
    ];
    expect(deriveQueuePosition(jobs, "wait-2")).toBe(2);

    // "job ahead" (wait-1) finishes and is removed from the occupying set —
    // wait-2 should now show 1 job ahead (the still-active job).
    const afterFirstFinishes = [job("active-1", "active", "2026-01-01T00:00:00Z"), job("wait-2", "created", "2026-01-01T00:02:00Z")];
    expect(deriveQueuePosition(afterFirstFinishes, "wait-2")).toBe(1);
  });

  it("excludes completed/cancelled/failed jobs from the occupying set", () => {
    const jobs = [
      job("done-1", "completed", "2025-12-31T00:00:00Z"),
      job("cancelled-1", "cancelled", "2025-12-31T00:00:00Z"),
      job("failed-1", "failed", "2025-12-31T00:00:00Z"),
      job("active-1", "active", "2026-01-01T00:00:00Z"),
    ];
    expect(deriveQueuePosition(jobs, "active-1")).toBe(0);
  });

  it("counts a 'retry' job as occupying a slot, same as 'created'", () => {
    const jobs = [job("active-1", "active", "2026-01-01T00:00:00Z"), job("retry-1", "retry", "2026-01-01T00:01:00Z")];
    expect(deriveQueuePosition(jobs, "retry-1")).toBe(1);
  });

  it("tie-breaks equal createdOn by job id", () => {
    const same = "2026-01-01T00:00:00Z";
    const jobs = [job("active-1", "active", same), job("bbb", "created", same), job("aaa", "created", same)];
    // "aaa" sorts before "bbb" — deterministic ordering even with identical timestamps.
    expect(deriveQueuePosition(jobs, "aaa")).toBe(1);
    expect(deriveQueuePosition(jobs, "bbb")).toBe(2);
  });

  it("returns null when the job id isn't found among occupying jobs", () => {
    const jobs = [job("active-1", "active", "2026-01-01T00:00:00Z")];
    expect(deriveQueuePosition(jobs, "missing")).toBeNull();
  });
});
