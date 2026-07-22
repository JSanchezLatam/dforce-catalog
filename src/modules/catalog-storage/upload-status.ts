/**
 * catalog-storage — `upload_status` state machine + pg-boss `pdf-upload`
 * worker (Risk-1, R11.5).
 *
 * design.md's pg-boss Job Definitions table specifies the `pdf-upload` job's
 * retry as pg-boss's OWN native `retryLimit`/`retryDelay` (set at send time
 * by pdf-generation/worker.ts), not a hand-rolled setTimeout loop — this
 * worker does exactly ONE upload attempt per invocation and rethrows on
 * failure; pg-boss reschedules the next attempt 30s later, or marks the job
 * `failed` once `retryLimit` is exhausted. Confirmed the exact transition
 * rule directly in node_modules/pg-boss/dist/plans.js: `WHEN retry_count <
 * retry_limit THEN 'retry' ELSE 'failed'` (same source-reading approach as
 * PR7's enqueue.ts, Context7 unavailable again this session). `retryLimit:2`
 * + `retryDelay:30` means at most 2 retries 30s apart — comfortably inside
 * R11.5's "hold up to 5 minutes" ceiling, so no separate timer/hold-duration
 * code is needed for that bound; the "holding" is simply the local temp file
 * (written by worker.ts) staying on disk until success or final failure.
 *
 * Risk-1's actual mitigation lives in pdf-generation/worker.ts + queries.ts's
 * `createPendingCatalog`: a `catalogs` row exists with `uploadStatus:
 * "pending"` BEFORE this worker ever runs, so a crash at any point — before
 * this job starts, mid-retry, or after final failure — always leaves a
 * visible, queryable row instead of a silently orphaned temp file.
 */
import { readFile, unlink } from "node:fs/promises";
import { eq } from "drizzle-orm";
import type { JobWithMetadata } from "pg-boss";

import { db } from "@/shared/db/client";
import { catalogs } from "@/shared/db/schema";
import { getBoss } from "@/shared/jobs/boss";
import { PDF_UPLOAD_JOB } from "../pdf-generation/enqueue";
import type { PdfUploadPayload } from "../pdf-generation/worker";
import { putObject } from "./r2";
import { runRetentionForUser } from "./retention";

export function buildCatalogPdfKey(catalogId: string): string {
  return `catalogs/${catalogId}.pdf`;
}

/**
 * Pure — true once pg-boss has exhausted `retryLimit` for this attempt (see
 * the header comment's plans.js transition rule). Drives whether a failure
 * is terminal (mark `uploadStatus: "failed"`, clean up the temp file) or
 * transient (rethrow only, let pg-boss retry, keep the temp file).
 */
export function isFinalAttempt(job: { retryCount: number; retryLimit: number }): boolean {
  return job.retryCount >= job.retryLimit;
}

type UploadJobLike = { data: PdfUploadPayload; retryCount: number; retryLimit: number };

type UploadDeps = {
  database?: typeof db;
  putObject?: typeof putObject;
  runRetentionForUser?: typeof runRetentionForUser;
  readFile?: typeof readFile;
  unlink?: typeof unlink;
};

/**
 * Exported so upload-status.test.ts can drive the full state machine with a
 * fake job + injected deps — no real pg-boss/R2/Postgres stack needed (same
 * DI convention as inventory-sync/job.ts's `deps.db ?? db`).
 */
export async function handlePdfUpload(job: UploadJobLike, deps: UploadDeps = {}): Promise<void> {
  const database = deps.database ?? db;
  const put = deps.putObject ?? putObject;
  const runRetention = deps.runRetentionForUser ?? runRetentionForUser;
  const read = deps.readFile ?? readFile;
  const remove = deps.unlink ?? unlink;
  const { catalogId, userId, pdfBufferRef } = job.data;

  await database.update(catalogs).set({ uploadStatus: "uploading" }).where(eq(catalogs.id, catalogId));

  try {
    const buffer = await read(pdfBufferRef);
    const key = buildCatalogPdfKey(catalogId);
    const r2Url = await put(key, buffer);
    await database
      .update(catalogs)
      .set({ uploadStatus: "uploaded", r2Key: key, r2Url })
      .where(eq(catalogs.id, catalogId));
    await remove(pdfBufferRef).catch(() => {});
    await runRetention(userId);
  } catch (err) {
    if (isFinalAttempt(job)) {
      // R11.5 — "notify the user if all retries fail": this app has no push/
      // email channel (design.md's Real-time decision is polling only), so
      // the listing page (R7, app/catalogs/page.tsx) reading `uploadStatus`
      // IS the notification surface.
      await database.update(catalogs).set({ uploadStatus: "failed" }).where(eq(catalogs.id, catalogId));
      await remove(pdfBufferRef).catch(() => {});
    }
    // Non-final failure: rethrow so pg-boss schedules the next retry; the
    // temp file is deliberately left in place for that retry to read.
    throw err;
  }
}

export async function registerPdfUploadWorker(deps: UploadDeps = {}): Promise<void> {
  const boss = await getBoss();
  await boss.createQueue(PDF_UPLOAD_JOB);
  await boss.work(PDF_UPLOAD_JOB, { includeMetadata: true }, async (jobs: JobWithMetadata<PdfUploadPayload>[]) => {
    await handlePdfUpload(jobs[0], deps);
  });
}
