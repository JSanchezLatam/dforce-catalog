/**
 * portal-sync/job.ts — the pg-boss worker that pushes one customer's snapshot to
 * the portal (customer-portal WU5a). Follows `reminders/job.ts`: the payload is
 * only `{ clienteId }`, and everything that matters is re-read at fire time.
 *
 * One transaction holds `pg_advisory_xact_lock` across read -> `nextval` ->
 * POST. Without it, job A could read old data, job B read newer data, and A
 * still draw the higher version, so the stale snapshot would win at the portal.
 * The cost is a pooled connection held for the length of one HTTP call
 * (15 s cap in `transport.ts`), at `localConcurrency: 1`.
 */
import * as Sentry from "@sentry/nextjs";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Job } from "pg-boss";
import type { IngestBody } from "@portal/contract";

import { env } from "@/shared/config/env";
import { db } from "@/shared/db/client";
import { cliente, clienteConsentimiento, ordenServicio, vehiculo } from "@/shared/db/schema";
import { getBoss } from "@/shared/jobs/boss";
import { withJobCapture } from "@/shared/jobs/capture";
import { ensurePortalSyncQueue, PORTAL_SYNC_JOB } from "./enqueue";
import { buildSnapshot, type SnapshotInput } from "./snapshot";
import { PortalRejectedError, sendToPortal, type PortalConfig } from "./transport";

export type SyncState = {
  deactivatedAt: Date | null;
  portalToken: string | null;
  /** `granted` of the NEWEST consent row; `null` when none was ever recorded. */
  latestGranted: boolean | null;
  vehicles: SnapshotInput["vehicles"];
  orders: SnapshotInput["orders"];
};

export type SyncDecision = "upsert" | "delete" | "skip";

/**
 * Live = active AND latest consent granted AND a token. Anything else sends a
 * delete, except a customer who never consented, who has nothing in the cloud
 * to remove and must not cause any request at all.
 */
export function decideSync(s: Pick<SyncState, "deactivatedAt" | "portalToken" | "latestGranted">): SyncDecision {
  if (s.latestGranted === null) return "skip";
  return s.deactivatedAt === null && s.latestGranted && s.portalToken ? "upsert" : "delete";
}

export type LockedQueries = {
  readState(): Promise<SyncState | null>;
  nextVersion(): Promise<number>;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function readState(tx: Tx, clienteId: string): Promise<SyncState | null> {
  const [row] = await tx
    .select({ deactivatedAt: cliente.deactivatedAt, portalToken: cliente.portalToken })
    .from(cliente)
    .where(eq(cliente.id, clienteId))
    .limit(1);
  if (!row) return null;

  // Newest by `recorded_at` (id only breaks an exact tie), same rule as `currentConsent`.
  const [consent] = await tx
    .select({ granted: clienteConsentimiento.granted })
    .from(clienteConsentimiento)
    .where(eq(clienteConsentimiento.clienteId, clienteId))
    .orderBy(desc(clienteConsentimiento.recordedAt), desc(clienteConsentimiento.id))
    .limit(1);

  const vehicles = await tx
    .select({
      id: vehiculo.id,
      plate: vehiculo.plate,
      make: vehiculo.make,
      model: vehiculo.model,
      year: vehiculo.year,
      deactivatedAt: vehiculo.deactivatedAt,
    })
    .from(vehiculo)
    .where(and(eq(vehiculo.clienteId, clienteId), isNull(vehiculo.deactivatedAt)))
    .orderBy(vehiculo.createdAt, vehiculo.id);

  const orders = await tx
    .select({
      id: ordenServicio.id,
      vehiculoId: ordenServicio.vehiculoId,
      status: ordenServicio.status,
      categoria: ordenServicio.categoria,
      createdAt: ordenServicio.createdAt,
      appointmentAt: ordenServicio.appointmentAt,
      completedAt: ordenServicio.completedAt,
      description: ordenServicio.description,
      hallazgos: ordenServicio.hallazgos,
      recomendaciones: ordenServicio.recomendaciones,
    })
    .from(ordenServicio)
    .innerJoin(vehiculo, eq(vehiculo.id, ordenServicio.vehiculoId))
    .where(and(eq(vehiculo.clienteId, clienteId), isNull(vehiculo.deactivatedAt)))
    .orderBy(desc(ordenServicio.createdAt), desc(ordenServicio.id));

  return {
    deactivatedAt: row.deactivatedAt,
    portalToken: row.portalToken,
    latestGranted: consent ? consent.granted : null,
    vehicles,
    orders: orders as SyncState["orders"],
  };
}

/** `nextval` is a bigint and node-postgres hands it back as a string. */
async function nextVersion(tx: Tx): Promise<number> {
  const result = await tx.execute(sql`SELECT nextval('portal_sync_version_seq') AS v`);
  const version = Number((result.rows[0] as { v: string }).v);
  if (!Number.isSafeInteger(version)) throw new Error("portal-sync: version sequence left the safe integer range");
  return version;
}

/** Real implementation: one transaction, the per-customer advisory lock first. */
async function withCustomerLock(clienteId: string, fn: (q: LockedQueries) => Promise<void>): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('portal-sync:' || ${clienteId}::text))`);
    await fn({ readState: () => readState(tx, clienteId), nextVersion: () => nextVersion(tx) });
  });
}

export type RunPortalSyncDeps = {
  /** Defaults to the env pair. Either one missing means the portal is not configured. */
  config?: { url?: string; secret?: string };
  withLock?: typeof withCustomerLock;
  send?: (body: IngestBody, config: PortalConfig) => Promise<void>;
  now?: () => Date;
};

export async function runPortalSync(clienteId: string, deps: RunPortalSyncDeps = {}): Promise<void> {
  const config = deps.config ?? { url: env.PORTAL_INGEST_URL, secret: env.PORTAL_INGEST_SECRET };
  // Inert when unconfigured: no database work, no request. The nightly reconcile catches up later.
  if (!config.url || !config.secret) return;
  const portal: PortalConfig = { url: config.url, secret: config.secret };
  const send = deps.send ?? sendToPortal;
  const now = deps.now ?? (() => new Date());

  await (deps.withLock ?? withCustomerLock)(clienteId, async (q) => {
    const state = await q.readState();
    if (!state) return;
    const decision = decideSync(state);
    if (decision === "skip") return;

    const version = await q.nextVersion();
    const body: IngestBody =
      decision === "upsert"
        ? buildSnapshot({ cliente: { id: clienteId, portalToken: state.portalToken }, vehicles: state.vehicles, orders: state.orders }, version, now())
        : { kind: "delete", clienteId, version };
    await send(body, portal);
  });
}

export type RegisterPortalSyncWorkerDeps = { getBoss?: typeof getBoss; run?: typeof runPortalSync };

/** Mirrors `registerReminderWorker`; registered at boot in `instrumentation-node.ts`. */
export async function registerPortalSyncWorker(deps: RegisterPortalSyncWorkerDeps = {}): Promise<void> {
  const boss = await (deps.getBoss ?? getBoss)();
  await ensurePortalSyncQueue(boss);
  await boss.work(
    PORTAL_SYNC_JOB,
    { localConcurrency: 1 },
    withJobCapture<Job>(PORTAL_SYNC_JOB, async ([job]) => {
      try {
        await (deps.run ?? runPortalSync)((job.data as { clienteId: string }).clienteId);
      } catch (error) {
        // A 4xx or a refused URL does not heal by waiting: report it and finish the job
        // instead of burning five retries. The nightly reconcile tries again.
        if (!(error instanceof PortalRejectedError)) throw error;
        Sentry.captureException(error, { tags: { job: PORTAL_SYNC_JOB, jobId: job.id } });
      }
    }),
  );
}
