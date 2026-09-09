/**
 * src/shared/db/text-search.ts — a neutral home for the accent-folding
 * comparison every list-search predicate needs (design D8, moved from
 * `customers/queries.ts:46`). `customers/queries.ts` and
 * `service-orders/queries.ts` both import it; the `or(...)` predicate each
 * builds around it is NOT shared — the two agree on two of three terms and
 * diverge on the third, and extracting the agreement would produce a helper
 * that is two-thirds of each (D8's "Not shared" note).
 */
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * `ilike` folds case but NOT accents, so 'María GONZÁLEZ' ilike '%maria%' is
 * false. Wrapping BOTH sides in `unaccent()` (extension enabled by migration
 * 0012) makes the fold symmetric: an unaccented term matches an accented row
 * and vice versa.
 *
 * `unaccent()` is STABLE, not IMMUTABLE, so it can never back an expression
 * index — see design.md's "Migration / Rollout". Correct at 364 rows; a
 * future `pg_trgm` upgrade must account for it.
 */
export function unaccentIlike(column: PgColumn, pattern: string): SQL {
  return sql`unaccent(${column}) ilike unaccent(${pattern})`;
}
