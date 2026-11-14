/**
 * usage/deliver.ts — sends the daily view totals to the support portal
 * (usage-metrics WU4, design §5, D4). Absolute totals in windows of at most 31
 * days, from the day after the watermark through today; only a 2xx advances the
 * watermark, and never past yesterday, so today is always resent. Nothing sent
 * to Sentry carries a count: only the error class and the HTTP status.
 */
import * as Sentry from "@sentry/nextjs";
import { and, asc, gte, lte, sql, type SQL } from "drizzle-orm";
import type { IngestBody } from "@portal/contract";

import { SCREEN_LABELS } from "@/modules/feedback/screen-labels";
import { sendToPortal } from "@/modules/portal-sync/transport";
import { env } from "@/shared/config/env";
import { db } from "@/shared/db/client";
import { usageDaily, usageDelivery } from "@/shared/db/schema";

export const USAGE_DELIVER_JOB = "usage-deliver";
/** The portal's limit on one body's range, inclusive (`portal/src/ingest/parse.ts`). */
const MAX_WINDOW_DAYS = 31;
const DAY_MS = 86_400_000;

type Usage = Extract<IngestBody, { kind: "usage" }>;
export type UsageCount = Usage["counts"][number];

/** Calendar arithmetic on a YYYY-MM-DD string; UTC so no DST or local zone can shift the day. */
const addDays = (day: string, n: number) => new Date(Date.parse(day) + n * DAY_MS).toISOString().slice(0, 10);

/** The workshop's calendar date of an instant, in SQL. A function of the instant so a test can pin it at a fixed one. */
export const panamaDateOf = (instant: SQL) => sql`(${instant}::timestamptz AT TIME ZONE 'America/Panama')::date`;

/** `start` is the first unacknowledged day, or null when nothing was ever counted and nothing acknowledged. `today` is the DATABASE's Panama date (design D3: one clock). */
export const readUsagePlan = async (): Promise<{ start: string | null; today: string }> => {
  const { rows } = await db.execute<{ start: string | null; today: string }>(sql`
    select
      to_char(coalesce((select ${usageDelivery.ackedThrough} + 1 from ${usageDelivery} where ${usageDelivery.id} = 1),
                       (select min(${usageDaily.day}) from ${usageDaily})), 'YYYY-MM-DD') as start,
      to_char(${panamaDateOf(sql`now()`)}, 'YYYY-MM-DD') as today`);
  return rows[0];
};

/** `day` is a `mode: "string"` date (YYYY-MM-DD) and `views` an int4, which node-postgres parses to a number. */
export const readUsageCounts = (from: string, to: string): Promise<UsageCount[]> =>
  db
    .select({ day: usageDaily.day, screen: usageDaily.screen, group: usageDaily.roleGroup, views: usageDaily.views })
    .from(usageDaily)
    .where(and(gte(usageDaily.day, from), lte(usageDaily.day, to)))
    .orderBy(asc(usageDaily.day), asc(usageDaily.screen), asc(usageDaily.roleGroup));

/** An upsert, so a missing watermark row cannot pin delivery to the same window forever. */
export const setUsageWatermark = async (day: string): Promise<void> => {
  await db.insert(usageDelivery).values({ id: 1, ackedThrough: day }).onConflictDoUpdate({ target: usageDelivery.id, set: { ackedThrough: day } });
};

export type DeliverUsageDeps = {
  config?: { url?: string; secret?: string };
  readPlan?: typeof readUsagePlan;
  readCounts?: typeof readUsageCounts;
  setWatermark?: typeof setUsageWatermark;
  report?: (error: Error, context: { level: "error"; tags: Record<string, string> }) => void;
  fetch?: typeof fetch;
};

/** Returns the number of batches the portal acknowledged. A send failure is reported, never thrown: the next hourly run retries from the same watermark. */
export async function deliverUsage(deps: DeliverUsageDeps = {}): Promise<number> {
  const config = deps.config ?? { url: env.PORTAL_INGEST_URL, secret: env.PORTAL_INGEST_SECRET };
  if (!config.url || !config.secret) return 0; // inert until the env is set
  const { start, today } = await (deps.readPlan ?? readUsagePlan)();
  if (!start) return 0;
  const screens = Object.entries(SCREEN_LABELS).map(([pattern, label]) => ({ pattern, label }));
  let acknowledged = 0;
  for (let from = start; from <= today; ) {
    const end = addDays(from, MAX_WINDOW_DAYS - 1);
    const to = end < today ? end : today;
    const counts = await (deps.readCounts ?? readUsageCounts)(from, to);
    try {
      await sendToPortal({ kind: "usage", from, to, screens, counts }, { url: config.url, secret: config.secret }, deps.fetch);
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : "unknown";
      const status = error instanceof Error ? (error as Error & { status?: unknown }).status : undefined;
      const tags = { job: USAGE_DELIVER_JOB, errorClass, ...(typeof status === "number" ? { status: String(status) } : {}) };
      // A fresh Error: the original's message is whatever the network layer put in it.
      try {
        (deps.report ?? Sentry.captureException)(new Error(`usage-deliver failed: ${errorClass}`), { level: "error", tags });
      } catch {
        // Best effort: the watermark is already safe.
      }
      return acknowledged;
    }
    await (deps.setWatermark ?? setUsageWatermark)(to < today ? to : addDays(today, -1));
    acknowledged++;
    from = addDays(to, 1);
  }
  return acknowledged;
}
