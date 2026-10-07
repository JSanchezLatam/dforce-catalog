/**
 * portal-sync/enqueue.ts — the producer side of the portal sync (customer-portal
 * WU5b). Every service that changes what a customer's snapshot holds calls
 * `enqueuePortalSync` AFTER its transaction commits. The contract that makes
 * that safe to call from a write path: it NEVER throws. A lost enqueue is
 * captured and the nightly reconcile (`reconcile.ts`) repairs it.
 *
 * Dedupe: queue policy `short` allows one QUEUED job per `singletonKey`, with
 * unlimited active ones. So a burst of edits for one customer is one job, while
 * an edit that lands while that customer's job is already running still queues
 * the next one (the running job may have read the data before the edit).
 */
import * as Sentry from "@sentry/nextjs";
import type { PgBoss } from "pg-boss";

import { env } from "@/shared/config/env";
import { getBoss } from "@/shared/jobs/boss";

export const PORTAL_SYNC_JOB = "portal-sync";
export const PORTAL_SYNC_DLQ = "portal-sync-dlq";

export async function ensurePortalSyncQueue(boss: PgBoss): Promise<void> {
  // The dead-letter queue must exist before a queue can reference it.
  await boss.createQueue(PORTAL_SYNC_DLQ);
  await boss.createQueue(PORTAL_SYNC_JOB, {
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    deadLetter: PORTAL_SYNC_DLQ,
    policy: "short",
  });
}

export type EnqueuePortalSyncDeps = {
  /** Defaults to the env pair. Either one missing means the portal is not configured. */
  config?: { url?: string; secret?: string };
  getBoss?: typeof getBoss;
  report?: (error: unknown, context: { tags: Record<string, string> }) => void;
};

export async function enqueuePortalSync(clienteId: string, deps: EnqueuePortalSyncDeps = {}): Promise<void> {
  try {
    const config = deps.config ?? { url: env.PORTAL_INGEST_URL, secret: env.PORTAL_INGEST_SECRET };
    // Inert when unconfigured: the nightly reconcile catches up once it is set.
    if (!config.url || !config.secret) return;
    const boss = await (deps.getBoss ?? getBoss)();
    await ensurePortalSyncQueue(boss);
    await boss.send(PORTAL_SYNC_JOB, { clienteId }, { singletonKey: clienteId });
  } catch (error) {
    try {
      (deps.report ?? Sentry.captureException)(error, { tags: { job: PORTAL_SYNC_JOB, phase: "enqueue" } });
    } catch {
      // Reporting is best effort too: the caller's committed write must never see this.
    }
  }
}

/** The service-side seam: every mutating service takes this optional dep so tests can observe the call. */
export type PortalSyncDeps = { enqueuePortalSync?: (clienteId: string) => Promise<void> };
