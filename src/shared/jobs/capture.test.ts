/**
 * design.md decision 18 / spec.md "Job Failure Capture and Rethrow" —
 * withJobCapture wraps a boss.work handler so a throw is reported to Sentry
 * tagged with the job name and the first job's id, then rethrown UNCHANGED
 * so pg-boss's own retry/deadletter behavior never changes.
 */
import { describe, expect, it, vi } from "vitest";
import { withJobCapture } from "./capture";

describe("withJobCapture", () => {
  it("passes the resolved value through and never calls report on success", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const report = vi.fn();
    const wrapped = withJobCapture("reminder-send", handler, report);

    await wrapped([{ id: "job-1" }]);

    expect(handler).toHaveBeenCalledWith([{ id: "job-1" }]);
    expect(report).not.toHaveBeenCalled();
  });

  it("reports the error with job/jobId tags and rethrows the SAME error object", async () => {
    const originalError = new Error("boom");
    const handler = vi.fn().mockRejectedValue(originalError);
    const report = vi.fn();
    const wrapped = withJobCapture("reminder-send", handler, report);

    await expect(wrapped([{ id: "job-1" }])).rejects.toBe(originalError);

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(originalError, {
      tags: { job: "reminder-send", jobId: "job-1" },
    });
  });

  it("still rethrows the original error when report itself throws", async () => {
    const originalError = new Error("boom");
    const handler = vi.fn().mockRejectedValue(originalError);
    const report = vi.fn().mockImplementation(() => {
      throw new Error("Sentry unreachable");
    });
    const wrapped = withJobCapture("reminder-send", handler, report);

    await expect(wrapped([{ id: "job-1" }])).rejects.toBe(originalError);
  });
});
