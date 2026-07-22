/**
 * catalog-storage — transactional per-user retention (Risk-4, R11.2-4).
 *
 * Same `pg_advisory_xact_lock` idiom as pdf-generation/enqueue.ts's Risk-2
 * guard (confirmed against the same pg-boss/Postgres advisory-lock pattern),
 * but scoped PER USER via the 2-int `(classid, objid)` overload —
 * `hashtext('catalog-retention')` + `hashtext(userId)` — so two catalogs
 * finishing near-simultaneously for the SAME user serialize around one lock
 * (the exact race design.md's Risk-4 flags), while different users'
 * evictions never block each other.
 *
 * Raw SQL against `catalogs` (not the query builder) for the same reason
 * enqueue.ts used it: keeps the transaction dependency mockable with a
 * minimal execute-only `TxLike` fake in unit tests, no real Postgres needed
 * — same convention as pdf-generation/enqueue.test.ts.
 */
import { sql } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { deleteObject } from "./r2";

export const RETENTION_LIMIT = 2; // R11.2 — max catalogs kept per user

/**
 * R11.3 — pure predicate for "will the next successful upload evict the
 * user's oldest catalog". Exported/unit-tested standalone (no DB) so the
 * exact trigger condition (a user who already has 2 stored catalogs) is
 * verifiable without a live Postgres connection — same DI-friendly style as
 * this module's other exports. Callers pass the user's CURRENT
 * `uploaded`-status count (see catalog-storage/queries.ts's
 * `countUploadedCatalogsForUser`).
 */
export function shouldWarnOfEviction(currentUploadedCount: number): boolean {
  return currentUploadedCount >= RETENTION_LIMIT;
}

type CatalogRow = { id: string; r2Key: string | null };
type TxLike = { execute: (query: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }> };

async function findEvictionCandidates(tx: TxLike, userId: string): Promise<CatalogRow[]> {
  // Oldest-first beyond the cap, restricted to "uploaded" rows only — a
  // "pending"/"uploading"/"failed" row has no R2 object to conflict with the
  // cap yet and must not be evicted out from under an in-flight upload.
  const result = await tx.execute(
    sql`SELECT id, r2_key AS "r2Key" FROM catalogs
        WHERE user_id = ${userId} AND upload_status = 'uploaded'
        ORDER BY created_at DESC
        OFFSET ${RETENTION_LIMIT}`,
  );
  return result.rows as CatalogRow[];
}

/**
 * R11.2-4 — call after a successful upload. Deletes the oldest catalog(s)
 * beyond `RETENTION_LIMIT` for this user: R2 object first, then the DB row.
 *
 * Partial-failure handling (design.md's Risk-4): if an R2 delete throws,
 * that row's DB delete is intentionally SKIPPED (not retried inline, not
 * aborting the whole batch) — a leftover DB row still pointing at a live R2
 * object is visible and will be retried on the next completion; the reverse
 * (a deleted DB row with an orphaned, un-referenced R2 object) would be a
 * silent, unrecoverable storage leak — same "visible over silently lost"
 * principle as Risk-1's `upload_status` state machine. Other candidates in
 * the same batch still proceed even if one fails.
 */
export async function runRetentionForUser(
  userId: string,
  deps: {
    database?: { transaction: <T>(fn: (tx: TxLike) => Promise<T>) => Promise<T> };
    deleteObject?: typeof deleteObject;
  } = {},
): Promise<{ evictedIds: string[] }> {
  const database = deps.database ?? db;
  const removeFromR2 = deps.deleteObject ?? deleteObject;

  return database.transaction(async (tx) => {
    // Held for the lifetime of this transaction — serializes any other
    // concurrent runRetentionForUser(userId) call for the SAME user.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('catalog-retention'), hashtext(${userId}))`);

    const candidates = await findEvictionCandidates(tx, userId);
    const evictedIds: string[] = [];

    for (const row of candidates) {
      if (row.r2Key) {
        try {
          await removeFromR2(row.r2Key);
        } catch (err) {
          console.error(
            `[catalog-storage] retention: failed to delete R2 object ${row.r2Key} — keeping catalog row ${row.id} for retry`,
            err,
          );
          continue;
        }
      }
      await tx.execute(sql`DELETE FROM catalogs WHERE id = ${row.id}`);
      evictedIds.push(row.id);
      // R11.4 — "log the event": previously only the failure branch above
      // logged anything; the success path had no entry at all (sdd-verify
      // WARNING).
      console.log(`[catalog-storage] retention: evicted catalog ${row.id} for user ${userId}`);
    }

    return { evictedIds };
  });
}
