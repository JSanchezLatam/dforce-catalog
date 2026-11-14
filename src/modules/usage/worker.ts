/**
 * usage/worker.ts — the hourly usage delivery (usage-metrics WU4, design §5, D5).
 * Off the :00 crowd; nobody waits on these numbers. Inert while
 * `PORTAL_INGEST_URL`/`PORTAL_INGEST_SECRET` are unset.
 */
import type { Job } from "pg-boss";

import { getBoss } from "@/shared/jobs/boss";
import { withJobCapture } from "@/shared/jobs/capture";
import { deliverUsage, USAGE_DELIVER_JOB } from "./deliver";

export const USAGE_DELIVER_CRON = "17 * * * *";
export const USAGE_DELIVER_TZ = "America/Panama";

export type RegisterUsageDeliveryDeps = {
  getBoss?: typeof getBoss;
  deliver?: () => Promise<unknown>;
};

/** Mirrors `registerFeedbackWorkers`: the schedule is idempotent per queue name. */
export async function registerUsageDelivery(deps: RegisterUsageDeliveryDeps = {}): Promise<void> {
  const boss = await (deps.getBoss ?? getBoss)();
  await boss.createQueue(USAGE_DELIVER_JOB);
  await boss.schedule(USAGE_DELIVER_JOB, USAGE_DELIVER_CRON, {}, { tz: USAGE_DELIVER_TZ });
  await boss.work(
    USAGE_DELIVER_JOB,
    { localConcurrency: 1 },
    withJobCapture<Job>(USAGE_DELIVER_JOB, async () => {
      // A send failure is reported inside and leaves the watermark; only a database error reaches here.
      await (deps.deliver ?? deliverUsage)();
    }),
  );
}
