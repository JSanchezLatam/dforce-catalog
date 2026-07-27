import { desc, eq, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";

import { db } from "@/shared/db/client";
import { producto, syncRuns, type SyncRun } from "@/shared/db/schema";
import { getBoss } from "@/shared/jobs/boss";
import { fetchAllProducts, type SyncFilters } from "./client";
import { parseProduct } from "./mapper";

export const INVENTORY_SYNC_JOB = "inventory-sync";
// design.md's "Open Questions" flags this cron literal as a placeholder pending
// confirmation with Dforce ops; kept identical to design.md so this PR doesn't
// invent a schedule decision that wasn't made.
const WEEKLY_CRON = "0 3 * * 0";

export type SyncPayload = {
  mode: "auto" | "manual";
  filters?: SyncFilters;
  triggeredBy?: string;
};

/** R2.5 — rejecting a concurrent manual sync with a proper message. */
export class SyncAlreadyRunningError extends Error {
  constructor(message = "A sync is already in progress") {
    super(message);
    this.name = "SyncAlreadyRunningError";
  }
}

/**
 * Risk-6 (design.md "New Risks Flagged" #6): pg-boss's `singletonKey` only
 * dedupes silently at the queue level — it would make a second manual
 * request a silent no-op instead of the explicit "already running" response
 * R2.5 requires. This queries the actual source of truth (`sync_runs`)
 * instead of relying on pg-boss internals.
 */
export async function hasActiveSyncRun(
  queryFn: () => Promise<{ id: string }[]> = () =>
    db.select({ id: syncRuns.id }).from(syncRuns).where(eq(syncRuns.status, "running")).limit(1),
): Promise<boolean> {
  const rows = await queryFn();
  return rows.length > 0;
}

/**
 * R2.4/R2.2 — powers the manual-sync status route: the last run's
 * status/productCount/finishedAt is the "notify count + timestamp" data
 * (no push/email channel exists, design.md's Real-time decision is
 * polling-only), and its absence-of-"running" is what tells the poller the
 * sync it started has finished.
 */
export async function getLatestSyncRun(
  queryFn: () => Promise<SyncRun[]> = () => db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1),
): Promise<SyncRun | null> {
  const rows = await queryFn();
  return rows[0] ?? null;
}

async function ensureQueue(boss: PgBoss): Promise<void> {
  // createQueue is an upsert (ON CONFLICT DO NOTHING under the hood) — safe
  // to call on every send/schedule, no separate bootstrap step needed.
  await boss.createQueue(INVENTORY_SYNC_JOB);
}

/** R2.1-5 — admin-triggered immediate full sync, guarded by the Risk-6 check above. */
export async function requestManualSync(
  triggeredBy: string,
  filters: SyncFilters = {},
  deps: { hasActiveSyncRun?: typeof hasActiveSyncRun; getBoss?: typeof getBoss } = {},
): Promise<void> {
  const checkActive = deps.hasActiveSyncRun ?? hasActiveSyncRun;
  if (await checkActive()) {
    throw new SyncAlreadyRunningError();
  }

  const boss = await (deps.getBoss ?? getBoss)();
  await ensureQueue(boss);
  await boss.send(
    INVENTORY_SYNC_JOB,
    { mode: "manual", filters, triggeredBy } satisfies SyncPayload,
    // Belt-and-suspenders: also dedupe at the pg-boss level so two near-
    // simultaneous requests that both pass the hasActiveSyncRun check can't
    // both enqueue (design.md's job table: singletonKey + singletonSeconds).
    { singletonKey: INVENTORY_SYNC_JOB, singletonSeconds: 60 },
  );
}

/** R1.1 — weekly scheduled full sync. */
export async function scheduleWeeklySync(): Promise<void> {
  const boss = await getBoss();
  await ensureQueue(boss);
  await boss.schedule(INVENTORY_SYNC_JOB, WEEKLY_CRON, { mode: "auto" } satisfies SyncPayload, {
    tz: "UTC",
  });
}

/**
 * Runs one full sync (weekly or manual): paginates the Interfuerza client and
 * upserts every product inside a single DB transaction, so a mid-run abort
 * (client.ts's `SyncAbortError`, after 3 retries) leaves prior `producto`
 * rows completely untouched (R1.9) — only the `sync_runs` audit row records
 * the failure, outside the rolled-back transaction.
 */
export async function runSync(
  payload: SyncPayload,
  deps: { db?: typeof db; fetchProducts?: typeof fetchAllProducts } = {},
): Promise<void> {
  const database = deps.db ?? db;
  const fetchProducts = deps.fetchProducts ?? fetchAllProducts;

  const [run] = await database.insert(syncRuns).values({ status: "running" }).returning({ id: syncRuns.id });

  let productCount = 0;
  try {
    await database.transaction(async (tx) => {
      for await (const page of fetchProducts(payload.filters ?? {})) {
        if (page.length === 0) continue;

        // Dedupe by id within the page (last occurrence wins, matching the
        // old per-row loop's behavior) — Postgres rejects a multi-row INSERT
        // that would ON CONFLICT DO UPDATE the same row twice in one
        // statement ("cannot affect row a second time"), which the old
        // per-row loop never hit since each row was its own statement.
        const rowsById = new Map<string, ReturnType<typeof parseProduct>>();
        for (const rawItem of page) {
          const parsed = parseProduct(rawItem as Record<string, unknown>);
          rowsById.set(parsed.id, parsed);
        }
        const rows = Array.from(rowsById.values()).map((parsed) => ({
          id: parsed.id,
          raw: parsed.raw,
          name: parsed.name,
          categoryL1: parsed.categoryL1,
          categoryL2: parsed.categoryL2,
          price: parsed.price,
          stock: parsed.stock,
          imageType: parsed.imageType,
        }));

        // Batched multi-row upsert — one round trip per PAGE_SIZE page (see
        // client.ts) instead of one per product row. Conflict target/updated
        // columns are unchanged from the per-row version; per-row values in
        // the UPDATE branch must reference Postgres's `excluded` pseudo-table
        // (drizzle-orm/guides/upsert.mdx "Upsert Multiple Rows") since a
        // single multi-row INSERT can't bind a distinct static value per
        // conflicting row the way the old per-row `.values(parsed)` call did.
        await tx
          .insert(producto)
          .values(rows)
          .onConflictDoUpdate({
            target: producto.id,
            set: {
              raw: sql.raw(`excluded.${producto.raw.name}`),
              name: sql.raw(`excluded.${producto.name.name}`),
              categoryL1: sql.raw(`excluded.${producto.categoryL1.name}`),
              categoryL2: sql.raw(`excluded.${producto.categoryL2.name}`),
              price: sql.raw(`excluded.${producto.price.name}`),
              stock: sql.raw(`excluded.${producto.stock.name}`),
              imageType: sql.raw(`excluded.${producto.imageType.name}`),
              syncedAt: new Date(),
            },
          });
        productCount += rows.length;
      }
    });

    await database
      .update(syncRuns)
      .set({ status: "completed", finishedAt: new Date(), productCount })
      .where(eq(syncRuns.id, run.id));
  } catch (error) {
    await database
      .update(syncRuns)
      .set({ status: "failed", finishedAt: new Date(), error: String(error) })
      .where(eq(syncRuns.id, run.id));
    throw error;
  }
}

/** Registers the pg-boss worker that actually executes `runSync` for both the weekly schedule and manual sends. */
export async function registerInventorySyncWorker(): Promise<void> {
  const boss = await getBoss();
  await ensureQueue(boss);
  // Deviation from design.md's literal `teamSize:1`: pg-boss 12.26.2 (the
  // pinned version — confirmed via node_modules/pg-boss/dist/types.d.ts)
  // renamed that option to `localConcurrency`. Same intent: at most 1
  // concurrent inventory-sync job per node.
  await boss.work<SyncPayload>(INVENTORY_SYNC_JOB, { localConcurrency: 1 }, async ([job]) => {
    await runSync(job.data);
  });
}
