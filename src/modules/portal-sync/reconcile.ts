/**
 * portal-sync/reconcile.ts — the nightly safety net (customer-portal WU5b).
 *
 * Every trigger is best effort (`enqueuePortalSync` never throws), so something
 * is always allowed to be lost. This job repairs it without reading the
 * portal's database: it re-enqueues every customer who has EVER had a consent
 * row (the worker decides upsert or delete from current state, so a missed
 * upsert is repaired, a missed delete repeated, a dead-lettered customer
 * retried), then tells the portal which customers are live so it can purge the
 * rest.
 */
import * as Sentry from "@sentry/nextjs";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Job } from "pg-boss";
import type { IngestBody } from "@portal/contract";

import { env } from "@/shared/config/env";
import { db } from "@/shared/db/client";
import { cliente, clienteConsentimiento } from "@/shared/db/schema";
import { getBoss } from "@/shared/jobs/boss";
import { withJobCapture } from "@/shared/jobs/capture";
import { enqueuePortalSync } from "./enqueue";
import { nextVersion } from "./job";
import { PortalRejectedError, sendToPortal, type PortalConfig } from "./transport";

export const PORTAL_RECONCILE_JOB = "portal-reconcile";
/** 03:00 in the workshop's zone. Panama has no DST, so the wall-clock time never moves. */
export const RECONCILE_CRON = "0 3 * * *";
export const RECONCILE_TZ = "America/Panama";

export type ReconcileQueries = {
  drawVersion(): Promise<number>;
  /** Every customer with at least one consent row, granted or revoked. */
  consentedIds(): Promise<string[]>;
  /** Live = active AND a token AND the NEWEST consent row granted: the same rule as `decideSync`. */
  liveIds(): Promise<string[]>;
};

const realQueries: ReconcileQueries = {
  drawVersion: () => nextVersion(db),
  async consentedIds() {
    const rows = await db.selectDistinct({ id: clienteConsentimiento.clienteId }).from(clienteConsentimiento);
    return rows.map((r) => r.id);
  },
  async liveIds() {
    // Newest by `recorded_at`, `id` only breaking an exact tie, as `currentConsent` and the worker do.
    const newestGranted = sql<boolean | null>`(
      SELECT ${clienteConsentimiento.granted} FROM ${clienteConsentimiento}
      WHERE ${clienteConsentimiento.clienteId} = ${cliente.id}
      ORDER BY ${desc(clienteConsentimiento.recordedAt)}, ${desc(clienteConsentimiento.id)} LIMIT 1
    )`;
    const rows = await db
      .select({ id: cliente.id })
      .from(cliente)
      .where(and(isNull(cliente.deactivatedAt), isNotNull(cliente.portalToken), eq(newestGranted, true)));
    return rows.map((r) => r.id);
  },
};

export type RunPortalReconcileDeps = {
  config?: { url?: string; secret?: string };
  queries?: ReconcileQueries;
  enqueue?: (clienteId: string) => Promise<void>;
  send?: (body: IngestBody, config: PortalConfig) => Promise<void>;
};

export async function runPortalReconcile(deps: RunPortalReconcileDeps = {}): Promise<void> {
  const config = deps.config ?? { url: env.PORTAL_INGEST_URL, secret: env.PORTAL_INGEST_SECRET };
  if (!config.url || !config.secret) return;
  const q = deps.queries ?? realQueries;

  // Drawn BEFORE the live set is read. A customer who turns live after this
  // point pushes a version above the bound, so the portal's purge (`version <
  // maxVersion`) spares it even though the set below predates it. Drawn after,
  // that customer could carry a lower version and be missing from the set.
  const maxVersion = await q.drawVersion();
  const liveClienteIds = await q.liveIds();
  const enqueue = deps.enqueue ?? enqueuePortalSync;
  for (const id of await q.consentedIds()) await enqueue(id);

  await (deps.send ?? sendToPortal)({ kind: "reconcile", liveClienteIds, maxVersion }, { url: config.url, secret: config.secret });
}

export type RegisterPortalReconcileDeps = { getBoss?: typeof getBoss; run?: typeof runPortalReconcile };

/** Mirrors `scheduleWeeklySync` + `registerInventorySyncWorker`: the schedule is idempotent per queue name. */
export async function registerPortalReconcile(deps: RegisterPortalReconcileDeps = {}): Promise<void> {
  const boss = await (deps.getBoss ?? getBoss)();
  await boss.createQueue(PORTAL_RECONCILE_JOB, { retryLimit: 3, retryDelay: 300, retryBackoff: true });
  await boss.schedule(PORTAL_RECONCILE_JOB, RECONCILE_CRON, {}, { tz: RECONCILE_TZ });
  await boss.work(
    PORTAL_RECONCILE_JOB,
    { localConcurrency: 1 },
    withJobCapture<Job>(PORTAL_RECONCILE_JOB, async ([job]) => {
      try {
        await (deps.run ?? runPortalReconcile)();
      } catch (error) {
        // Same rule as the sync worker: a 4xx does not heal by waiting. Tomorrow's run tries again.
        if (!(error instanceof PortalRejectedError)) throw error;
        Sentry.captureException(error, { tags: { job: PORTAL_RECONCILE_JOB, jobId: job.id } });
      }
    }),
  );
}
