/**
 * feedback/worker.ts — the sweeper and the deliver worker (in-app-feedback WU4,
 * design §3). The route's inline attempt is the fast path; this repairs every
 * row it left behind. Inert while `PORTAL_INGEST_URL`/`PORTAL_INGEST_SECRET` are unset.
 */
import { and, asc, isNull, lte, sql } from "drizzle-orm";
import type { Job } from "pg-boss";

import { env } from "@/shared/config/env";
import { db } from "@/shared/db/client";
import { feedback } from "@/shared/db/schema";
import { getBoss } from "@/shared/jobs/boss";
import { withJobCapture } from "@/shared/jobs/capture";
import { deliverFeedback, FEEDBACK_DELIVER_JOB } from "./deliver";

export const FEEDBACK_SWEEP_JOB = "feedback-sweep";
export const SWEEP_CRON = "* * * * *";
export const SWEEP_TZ = "America/Panama";
/** A bounded batch: a backlog drains over several minutes instead of one burst at the portal. */
export const SWEEP_BATCH = 25;
/** The worker has no operator waiting, unlike the route's 5 s inline attempt. */
const DELIVER_TIMEOUT_MS = 15_000;

/** Oldest first; `feedback_pending_idx` (created_at WHERE delivered_at IS NULL) serves it. */
const realSelectDue = async (limit: number): Promise<string[]> => {
  const rows = await db
    .select({ id: feedback.id })
    .from(feedback)
    .where(and(isNull(feedback.deliveredAt), lte(feedback.nextAttemptAt, sql`now()`)))
    .orderBy(asc(feedback.createdAt))
    .limit(limit);
  return rows.map((r) => r.id);
};

export type RunFeedbackSweepDeps = {
  config?: { url?: string; secret?: string };
  selectDue?: (limit: number) => Promise<string[]>;
  send?: (name: string, data: { id: string }, options: { singletonKey: string; retryLimit: number }) => Promise<unknown>;
};

export async function runFeedbackSweep(deps: RunFeedbackSweepDeps = {}): Promise<void> {
  const config = deps.config ?? { url: env.PORTAL_INGEST_URL, secret: env.PORTAL_INGEST_SECRET };
  if (!config.url || !config.secret) return;
  const send = deps.send ?? (async (...args: Parameters<NonNullable<RunFeedbackSweepDeps["send"]>>) => (await getBoss()).send(...args));
  for (const id of await (deps.selectDue ?? realSelectDue)(SWEEP_BATCH)) {
    await send(FEEDBACK_DELIVER_JOB, { id }, { singletonKey: id, retryLimit: 0 });
  }
}

export type RegisterFeedbackWorkersDeps = {
  getBoss?: typeof getBoss;
  sweep?: typeof runFeedbackSweep;
  deliver?: (id: string, timeoutMs: number) => Promise<unknown>;
};

/** Mirrors `registerPortalReconcile`: the schedule is idempotent per queue name. */
export async function registerFeedbackWorkers(deps: RegisterFeedbackWorkersDeps = {}): Promise<void> {
  const boss = await (deps.getBoss ?? getBoss)();
  await boss.createQueue(FEEDBACK_DELIVER_JOB, { policy: "short", retryLimit: 0 });
  await boss.createQueue(FEEDBACK_SWEEP_JOB);
  await boss.schedule(FEEDBACK_SWEEP_JOB, SWEEP_CRON, {}, { tz: SWEEP_TZ });
  await boss.work(
    FEEDBACK_SWEEP_JOB,
    { localConcurrency: 1 },
    withJobCapture<Job>(FEEDBACK_SWEEP_JOB, async () => {
      await (deps.sweep ?? runFeedbackSweep)();
    }),
  );
  await boss.work(
    FEEDBACK_DELIVER_JOB,
    { localConcurrency: 1 },
    withJobCapture<Job>(FEEDBACK_DELIVER_JOB, async ([job]) => {
      // `deliverFeedback` never throws and keeps its own retry state in the row.
      await (deps.deliver ?? deliverFeedback)((job.data as { id: string }).id, DELIVER_TIMEOUT_MS);
    }),
  );
}
