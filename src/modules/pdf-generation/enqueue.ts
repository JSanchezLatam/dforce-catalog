/**
 * pdf-generation — bounded queue producer (R12, Risk-2).
 *
 * pg-boss (12.26.2, confirmed via node_modules/pg-boss/dist/plans.js) has no
 * built-in "max N total jobs for this queue" cap and no `getQueueSize()`
 * convenience method — enforcing R12.1/12.5/12.6 (1 active + 2 waiting = 3
 * total) means querying its own `pgboss.job` table directly. Two concurrent
 * enqueue attempts could otherwise both read depth=2 and both push through,
 * landing at 4 total jobs (design.md's "New Risks Flagged" #2). A
 * `pg_advisory_xact_lock` — the same idiom pg-boss itself uses internally for
 * its own locked operations, see plans.js's `advisoryLock()` — serializes the
 * count-then-send decision around one session-scoped Postgres lock (held for
 * the lifetime of one `db.transaction()`, auto-released on commit/rollback)
 * so only one enqueue attempt can be inside that decision window at a time.
 */
import { sql } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { getBoss } from "@/shared/jobs/boss";
import type { CatalogIndexSection, CatalogTemplateBranding, ProductPrintRef } from "@/shared/template/CatalogTemplate";

export const PDF_GENERATE_JOB = "pdf-generate";
export const PDF_UPLOAD_JOB = "pdf-upload";

// R12.1/12.5 — 1 active + 2 waiting = 3 total (design.md's pg-boss Job Definitions table).
export const MAX_QUEUE_DEPTH = 3;

// Job states that occupy a queue slot — a job that failed and is awaiting its
// own retry backoff still holds its place, same as "active"/"created".
const OCCUPYING_STATES_SQL = sql`('created','retry','active')`;

export type PdfGeneratePayload = {
  catalogId: string;
  userId: string;
  title: string;
  branding: CatalogTemplateBranding | null;
  sections: CatalogIndexSection[];
  products: ProductPrintRef[];
  productsPerPage: number;
  defaultImageHandling?: "strict" | "adaptive" | null;
};

/** R12.6 — thrown when the queue already holds MAX_QUEUE_DEPTH jobs. */
export class QueueFullError extends Error {
  constructor(message = `Queue is full (max ${MAX_QUEUE_DEPTH} jobs) — try again once a job finishes`) {
    super(message);
    this.name = "QueueFullError";
  }
}

type TxLike = { execute: (query: ReturnType<typeof sql>) => Promise<{ rows: { count: number }[] }> };

async function countOccupyingJobs(tx: TxLike, queueName: string): Promise<number> {
  const result = await tx.execute(
    sql`SELECT count(*)::int AS count FROM pgboss.job WHERE name = ${queueName} AND state IN ${OCCUPYING_STATES_SQL}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Risk-2 — the ONLY function allowed to call `boss.send(PDF_GENERATE_JOB, ...)`.
 * Wraps the advisory lock + depth count + send in one Postgres transaction so
 * two simultaneous requests can't both observe depth=2 and both proceed.
 */
export async function enqueueCatalogPdf(
  payload: PdfGeneratePayload,
  deps: {
    getBoss?: typeof getBoss;
    database?: { transaction: <T>(fn: (tx: TxLike) => Promise<T>) => Promise<T> };
  } = {},
): Promise<{ jobId: string }> {
  const database = deps.database ?? db;
  const boss = await (deps.getBoss ?? getBoss)();
  await boss.createQueue(PDF_GENERATE_JOB);

  return database.transaction(async (tx) => {
    // Session-scoped to this transaction — blocks any other concurrent
    // enqueueCatalogPdf() transaction until this one commits/rolls back.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('pdf-generate-queue-depth'))`);

    const depth = await countOccupyingJobs(tx, PDF_GENERATE_JOB);
    if (depth >= MAX_QUEUE_DEPTH) {
      throw new QueueFullError();
    }

    const jobId = await boss.send(PDF_GENERATE_JOB, payload);
    if (!jobId) {
      throw new Error("pg-boss rejected the pdf-generate job unexpectedly");
    }
    return { jobId };
  });
}
