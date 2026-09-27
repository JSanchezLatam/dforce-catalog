import * as Sentry from "@sentry/nextjs";

type CaptureReport = (error: unknown, context: { tags: Record<string, string> }) => void;

/**
 * design.md decision 18 / spec.md "Job Failure Capture and Rethrow" — wraps
 * a boss.work handler so a thrown error is reported to Sentry tagged with
 * the job name and the first job's id, then RETHROWN UNCHANGED so pg-boss's
 * own retry/deadletter behavior is byte-for-byte what it is today.
 *
 * `report` defaults to Sentry.captureException and is injectable for tests,
 * mirroring this codebase's register*Worker({ getBoss }) seam convention.
 * The report call itself is guarded: if Sentry is unreachable, the ORIGINAL
 * error is still what pg-boss sees.
 */
export function withJobCapture<J extends { id: string }>(
  job: string,
  handler: (jobs: J[]) => Promise<void>,
  report: CaptureReport = Sentry.captureException,
): (jobs: J[]) => Promise<void> {
  return async (jobs: J[]) => {
    try {
      await handler(jobs);
    } catch (error) {
      try {
        report(error, { tags: { job, jobId: jobs[0]?.id ?? "unknown" } });
      } catch {
        // Reporting failed (e.g. Sentry unreachable) — never mask the
        // original error pg-boss needs to see for retry/deadletter.
      }
      throw error;
    }
  };
}
