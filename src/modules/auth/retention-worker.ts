/**
 * The daily 90-day retention of login attempts (S10). Off the hour and out of
 * working hours: the workshop PC is the database too.
 */
import type { Job } from "pg-boss";

import { getBoss } from "@/shared/jobs/boss";
import { withJobCapture } from "@/shared/jobs/capture";

import { purgeOldLoginAttempts } from "./login-attempts";

export const LOGIN_RETENTION_JOB = "login-attempts-retention";
export const LOGIN_RETENTION_CRON = "40 3 * * *";
export const LOGIN_RETENTION_TZ = "America/Panama";

export type RegisterLoginAttemptsRetentionDeps = {
  getBoss?: typeof getBoss;
  purge?: () => Promise<number>;
};

/** Mirrors `registerUsageDelivery`: the schedule is idempotent per queue name. */
export async function registerLoginAttemptsRetention(deps: RegisterLoginAttemptsRetentionDeps = {}): Promise<void> {
  const boss = await (deps.getBoss ?? getBoss)();
  await boss.createQueue(LOGIN_RETENTION_JOB);
  await boss.schedule(LOGIN_RETENTION_JOB, LOGIN_RETENTION_CRON, {}, { tz: LOGIN_RETENTION_TZ });
  await boss.work(
    LOGIN_RETENTION_JOB,
    { localConcurrency: 1 },
    withJobCapture<Job>(LOGIN_RETENTION_JOB, async () => {
      await (deps.purge ?? purgeOldLoginAttempts)();
    }),
  );
}
