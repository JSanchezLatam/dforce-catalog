import { eq, sql } from "drizzle-orm";

import type { TxLike as BaseTxLike } from "@/modules/customers/vehicles";
import { db } from "@/shared/db/client";
import { cliente, customerImportRuns } from "@/shared/db/schema";
import { fetchAllCustomers } from "./client";
import { mapCustomerRow, type MappedRow, type SkipReason } from "./mapper";
import { planImport, type LocalCustomer } from "./plan";

/**
 * Runs the whole Interfuerza customer import. Fetch and mapping happen
 * BEFORE the transaction opens — design.md D6 only requires the WRITES to be
 * all-or-nothing, not the fetch itself. Draining every page with the
 * transaction open would hold a Postgres connection idle-in-transaction for
 * the whole fetch: 14 * `RATE_LIMIT_SPACING_MS` on the happy path, and up to
 * 2 * `RETRY_INTERVAL_MS` (120s) per retried page on a flaky one — inside a
 * synchronous HTTP request handler. With the fetch outside the transaction,
 * an `InterfuerzaAbortError` there leaves nothing persisted for free: no
 * write has happened yet. Once the transaction opens, `listExisting`, the
 * plan, and every insert/update are all inside it and either all commit or
 * none do (mirrors `inventory-sync/job.ts`'s `runSync`). A skip is not an
 * abort: the run completes and reports it (D5, R21).
 *
 * CONCURRENCY (two operators, or one with two tabs, both clicking import
 * while a first run is still draining pages): Postgres defaults to READ
 * COMMITTED, so a second run's `listExisting` cannot see a first run's
 * uncommitted inserts — both would plan `insert` for the same external id,
 * both commit, and `external_id` deliberately carries no unique index
 * (design D2), so nothing downstream would catch the duplicate. Two layers
 * guard against this, and only one of them is the actual guarantee:
 *
 *  - Layer 1 (fast rejection, BEFORE the fetch): `defaultStartImportRunIfNotActive`
 *    (see its own docstring) is ONE statement — `INSERT ... SELECT ...
 *    WHERE NOT EXISTS (...) RETURNING id` — so there is no gap between
 *    "is one running?" and "mark one running" for a second click to land
 *    in. This is what makes rejecting a second click actually cost nothing
 *    against Interfuerza: fix 1 (customer-import-fixes) replaced a
 *    two-await check-then-act shape whose gap let two concurrent clicks
 *    both pass the check and both spend a full ~15-request fetch against an
 *    API that carries a real 1h IP ban — exactly the cost this layer exists
 *    to avoid. A residual,
 *    much narrower race is still possible and is documented on
 *    `defaultStartImportRunIfNotActive` itself, not claimed away here.
 *  - Layer 2 (the actual guarantee against a duplicate `cliente` row):
 *    `pg_advisory_xact_lock`, taken as the very first statement inside the
 *    write transaction, before `listExisting` runs. A second concurrent
 *    transaction blocks on this exact statement until the first commits or
 *    rolls back, then its own `listExisting` sees the now-committed rows and
 *    plans an UPDATE instead of a second INSERT. Same idiom as
 *    `pdf-generation/enqueue.ts` and `catalog-storage/retention.ts`. This is
 *    what still catches layer 1's residual race, if it is ever lost.
 */

export type ImportSkip = { externalId: string | null; name: string | null; reason: SkipReason };
export type ImportResult = { created: number; updated: number; skipped: ImportSkip[] };

/**
 * Widens `customers/vehicles.ts`'s `TxLike` with `execute`, needed for the
 * layer-2 advisory lock statement below. Exported for the same reason
 * `vehicles.ts` exports its own: it appears in `RunCustomerImportDeps`, so a
 * caller building a fake `tx` would otherwise have to hand-redeclare it and
 * keep the copy in lockstep with nothing enforcing it.
 */
export type TxLike = BaseTxLike & {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }>;
};

/** The patch `finishImportRun` receives. Exported alongside `TxLike`, and for the same reason. */
export type ImportRunPatch = {
  status: "completed" | "failed";
  created?: number;
  updated?: number;
  skippedCount?: number;
  error?: string;
};

export type RunCustomerImportDeps = {
  fetchCustomers?: () => AsyncGenerator<unknown[]>;
  database?: { transaction: <T>(fn: (tx: TxLike) => Promise<T>) => Promise<T> };
  listExisting?: (tx: TxLike) => Promise<LocalCustomer[]>;
  /**
   * Layer 1's only seam: ONE statement, see `buildStartImportRunStatement`.
   * `null` means a run is already active. There is deliberately no second
   * "check" seam beside it — a separate check-then-act pair is the exact
   * shape fix 1 removed, and keeping one wired for tests would leave
   * production on the branch with the least unit coverage.
   */
  startImportRunIfNotActive?: () => Promise<{ id: string } | null>;
  finishImportRun?: (id: string, patch: ImportRunPatch) => Promise<void>;
};

async function defaultListExisting(tx: TxLike): Promise<LocalCustomer[]> {
  return tx.select({ id: cliente.id, externalId: cliente.externalId }).from(cliente);
}

/** R21 — thrown by layer 1 (see the module docstring above) when a run is already in progress. */
export class ImportAlreadyRunningError extends Error {
  constructor(message = "A customer import is already in progress") {
    super(message);
    this.name = "ImportAlreadyRunningError";
  }
}

/**
 * Layer 1's statement. Pure (built, not executed), so a unit test can
 * inspect the compiled SQL via `PgDialect().sqlToQuery()` without a live
 * Postgres connection — exported only for that reason.
 *
 * ONE statement: the "is a run active?" check and the "mark one running"
 * write happen inside the same `INSERT ... SELECT ... WHERE NOT EXISTS`, so
 * there is no gap between them for a second click to land in.
 *
 * `status = 'running'` is deliberately NOT the whole condition: a kill
 * between this insert and `finishRun` (a deploy, an OOM, the host reaping a
 * long request — this module runs synchronously inside an HTTP handler, per
 * the module docstring) leaves that row `running` forever, and with no time
 * bound every later import would answer 409 forever for a run that already
 * died.
 *
 * The 45-minute window is sized against the real worst case this module's
 * own fetch loop can produce, not guessed: `MAX_ATTEMPTS` (client.ts) is 3,
 * so a page that keeps failing sleeps `RETRY_INTERVAL_MS` (60s) twice before
 * `fetchPageWithRetry` gives up — 120s of pure retry sleep per retried page.
 * Across all 15 customer pages (`PAGE_SIZE`/measured `count`, client.ts)
 * failing every single attempt, that is 15 * 120s = 1800s = 30 minutes of
 * sleep alone, BEFORE counting the network time each of the up-to-3 attempts
 * per page actually takes, or the write-transaction phase (`listExisting`
 * plus one insert/update per row) that only starts after the fetch loop
 * finishes. 45 minutes keeps a 15-minute margin over that 30-minute
 * sleep-only floor for those uncounted phases, so a run that is merely
 * slow — not dead — is never reaped out from under itself; a run that
 * really did die stops blocking new imports after at most 45 minutes
 * instead of forever.
 *
 * Residual window (named, not claimed away): this single statement is not a
 * unique constraint or an explicit lock. Under READ COMMITTED, two of these
 * statements issued from two different connections each take their own MVCC
 * snapshot; neither sees the other's row until it commits, so if both
 * snapshots are taken before either commits, BOTH can pass `WHERE NOT
 * EXISTS` and both insert. What this fix buys is shrinking that window from
 * "the whole ~15-page fetch loop, 7.5s to 120s" (the bug) down to "the round
 * trip of one INSERT statement to Postgres" — realistically low
 * single-digit milliseconds, not seconds or minutes. A double-click can
 * still rarely land inside that much smaller window; when it does, layer 2
 * (`pg_advisory_xact_lock`, still the actual guarantee against a duplicate
 * `cliente` row) is what catches it, and the loser just re-spends its own
 * ~15 Interfuerza requests instead of a rejected one costing nothing.
 *
 * `id` is passed in rather than defaulted by the DB: `customer_import_runs.id`
 * has no DB-level default (schema.ts's `$defaultFn(() => crypto.randomUUID())`
 * only runs through drizzle's own `.insert().values()`, which this raw
 * statement bypasses), so every row from this path would otherwise fail its
 * NOT NULL constraint.
 */
export function buildStartImportRunStatement(id: string) {
  return sql`
    insert into customer_import_runs (id, status)
    select ${id}, 'running'::customer_import_status
    where not exists (
      select 1 from customer_import_runs
      where status = 'running' and started_at > now() - interval '45 minutes'
    )
    returning id
  `;
}

async function defaultStartImportRunIfNotActive(): Promise<{ id: string } | null> {
  const result = await db.execute<{ id: string }>(buildStartImportRunStatement(crypto.randomUUID()));
  const [row] = result.rows;
  return row ? { id: row.id } : null;
}

async function defaultFinishImportRun(id: string, patch: ImportRunPatch): Promise<void> {
  // `finishedAt` is stamped here rather than by callers: this function is
  // the only thing that knows a run just finished, and a fake that forgets
  // it can no longer look like a real finish.
  await db
    .update(customerImportRuns)
    .set({ ...patch, finishedAt: new Date() })
    .where(eq(customerImportRuns.id, id));
}

export async function runCustomerImport(deps: RunCustomerImportDeps = {}): Promise<ImportResult> {
  const fetchCustomers = deps.fetchCustomers ?? fetchAllCustomers;
  const database = deps.database ?? db;
  const listExisting = deps.listExisting ?? defaultListExisting;
  const finishRun = deps.finishImportRun ?? defaultFinishImportRun;

  // Layer 1 — see module docstring and `startRunOrThrow`. Rejects BEFORE
  // fetchCustomers() is even called, so a second concurrent click costs
  // nothing against Interfuerza (barring the residual window documented on
  // `defaultStartImportRunIfNotActive`).
  const run = await (deps.startImportRunIfNotActive ?? defaultStartImportRunIfNotActive)();
  if (!run) {
    throw new ImportAlreadyRunningError();
  }

  try {
    const mapped: MappedRow[] = [];
    for await (const page of fetchCustomers()) {
      for (const raw of page) mapped.push(mapCustomerRow(raw));
    }

    const result = await database.transaction(async (tx) => {
      // Layer 2 — the actual guarantee (see module docstring). Must run
      // BEFORE `listExisting`: taking it after the read would let a second
      // transaction's read race in ahead of this one's writes, which is
      // exactly the bug being fixed.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('customer-import'))`);

      // `listExisting` stays inside the transaction, alongside the writes:
      // the plan must be built against what this same transaction will see.
      const existing = await listExisting(tx);
      const plan = planImport(mapped, existing);

      let created = 0;
      let updated = 0;
      const skipped: ImportSkip[] = [];

      for (const row of plan) {
        if (row.kind === "skip") {
          skipped.push({ externalId: row.externalId, name: row.name, reason: row.reason });
        } else if (row.kind === "insert") {
          await tx.insert(cliente).values({ externalId: row.externalId, ...row.data });
          created++;
        } else {
          await tx.update(cliente).set(row.patch).where(eq(cliente.id, row.id));
          updated++;
        }
      }

      return { created, updated, skipped };
    });

    await finishRun(run.id, {
      status: "completed",
      created: result.created,
      updated: result.updated,
      skippedCount: result.skipped.length,
    });
    return result;
  } catch (error) {
    // If `finishRun` itself rejects (finding 2), do not let that rejection
    // REPLACE `error` — the operator needs the real cause, not a secondary
    // bookkeeping failure, and losing it also compounds finding 1 (the row
    // stays `running` with no record of why).
    try {
      await finishRun(run.id, { status: "failed", error: String(error) });
    } catch {
      // Swallowed deliberately — `error` below is still the original cause.
    }
    throw error;
  }
}
