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
import { createPendingCatalog } from "../catalog-storage/queries";
import type { CatalogIndexSection, ProductPrintRef, WorkshopContact } from "@/shared/template/CatalogTemplate";
import type { PriceTier } from "@/shared/template/price-tiers";
import { MAX_QUEUE_DEPTH } from "./queue-limits";

export const PDF_GENERATE_JOB = "pdf-generate";
export const PDF_UPLOAD_JOB = "pdf-upload";

// R12.1/12.5 — re-exported: it lives in a client-safe module because the
// builder's Generar button disables against the same number.
export { MAX_QUEUE_DEPTH };

/**
 * pdf-generate's retry policy, stated here rather than inherited from
 * pg-boss's queue default (retryLimit 2, retryDelay 0 in 12.26.2's plans.js
 * QUEUE_DEFAULTS). The worker marks the catalog `failed` on the attempt where
 * `retryCount >= retryLimit`, so "final attempt" must be a number this code
 * owns. One retry, ten seconds later, covers a transient Chromium crash; a
 * render that fails twice is not going to succeed a third time, and every
 * attempt holds the single active slot while the operator waits for news.
 */
export const PDF_GENERATE_RETRY = { retryLimit: 1, retryDelay: 10 } as const;

// Job states that occupy a queue slot — a job that failed and is awaiting its
// own retry backoff still holds its place, same as "active"/"created".
const OCCUPYING_STATES_SQL = sql`('created','retry','active')`;

/**
 * catalog-templates-and-workshop-info WU3 (design D2) — what crosses pg-boss,
 * distinct from `CatalogTemplateBranding` (what the renderer consumes).
 * `logoR2Key` is an R2 object key, never base64 (a multi-MB blob in JSONB
 * would bloat `pgboss.job`) — `worker.ts`'s `resolveBranding` reads the
 * object server-side and turns it into the renderer's `data:` URI.
 */
export type PdfBranding = {
  templateId: string;
  logoR2Key: string | null;
  logoContentType: string | null;
  coverText: string | null;
  /**
   * WU5 (design D6) — same R2-key pair as `logoR2Key`/`logoContentType`,
   * resolved into a `data:` URI by `worker.ts`'s `resolveBranding` (same
   * server-side R2 read WU3 built for the logo — Playwright cannot
   * authenticate against the session-gated cover-image route). `contact`
   * travels verbatim — no R2 read, it is plain text. Both optional (not
   * `design.md`'s literal required fields) so the pre-WU5 `worker.test.ts`
   * literals keep compiling unchanged.
   */
  coverImageR2Key?: string | null;
  coverImageContentType?: string | null;
  contact?: WorkshopContact | null;
};

export type PdfGeneratePayload = {
  catalogId: string;
  userId: string;
  title: string;
  branding: PdfBranding | null;
  sections: CatalogIndexSection[];
  products: ProductPrintRef[];
  productsPerPage: number;
  /** R13 — the price rows to print. Absent on jobs enqueued before tier selection existed; `CatalogTemplate` defaults those. */
  tiers?: readonly PriceTier[] | null;
  defaultImageHandling?: "strict" | "adaptive" | null;
};

/** R12.6 — thrown when the queue already holds MAX_QUEUE_DEPTH jobs. */
export class QueueFullError extends Error {
  constructor(message = `Queue is full (max ${MAX_QUEUE_DEPTH} jobs) — try again once a job finishes`) {
    super(message);
    this.name = "QueueFullError";
  }
}

type TxLike = {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: { count: number }[] }>;
  insert: typeof db.insert;
};

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
    createPendingCatalog?: typeof createPendingCatalog;
  } = {},
): Promise<{ jobId: string }> {
  const database = deps.database ?? db;
  const insertPendingCatalog = deps.createPendingCatalog ?? createPendingCatalog;
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

    // The `catalogs` row is born here, so /catalogs shows the catalog the
    // moment Generar returns and the worker has a row to mark `failed`. After
    // the depth check — a full queue inserts nothing — and through `tx`, so a
    // send that throws (or returns no id) rolls the row back with the
    // transaction. `boss.send` commits on pg-boss's own connection, so the
    // one window left is a COMMIT that fails after the send succeeded: a job
    // with no row, which the worker's UPDATEs then touch zero rows of.
    await insertPendingCatalog(payload, tx);

    const jobId = await boss.send(PDF_GENERATE_JOB, payload, PDF_GENERATE_RETRY);
    if (!jobId) {
      throw new Error("pg-boss rejected the pdf-generate job unexpectedly");
    }
    return { jobId };
  });
}
