import {
  fetchAllPages,
  InterfuerzaAbortError,
  MAX_ATTEMPTS,
  PAGE_SIZE,
  RATE_LIMIT_SPACING_MS,
  RETRY_INTERVAL_MS,
  type FilterEntry,
  type InterfuerzaOptions,
} from "@/shared/interfuerza/client";

/**
 * The products half of the Interfuerza integration.
 *
 * The transport — sequential pagination, the 3-attempt retry, the 500ms
 * spacing, and the abort semantics — moved to `shared/interfuerza/client.ts`
 * when `customer-import` became a second caller. What stays here is the only
 * thing that is actually product-specific: the category filter shape.
 *
 * The public API below is UNCHANGED, deliberately. `client.test.ts` passed
 * without a single edit AT THE EXTRACTION COMMIT — that was the proof the
 * extraction itself changed no behaviour. It stopped being true one commit
 * later: a `count` guard added INSIDE the shared transport changed behaviour
 * on the products path (the API sends `count` as a STRING, not the numeric
 * value every fixture here hands back), and this file's untouched tests
 * structurally could not see it. See the `describe("fetchAllProducts — the
 * wire shape of \`count\` (post-extraction)")` block at the bottom of
 * `client.test.ts` for the case that closed that gap.
 */

export { MAX_ATTEMPTS, PAGE_SIZE, RATE_LIMIT_SPACING_MS, RETRY_INTERVAL_MS };

/**
 * Re-exported under its original name, not re-declared: `job.ts` and both test
 * files check `instanceof`, so a second class would break every one of them
 * while looking identical.
 */
export { InterfuerzaAbortError as SyncAbortError };

export type SyncFilters = { l1?: string; l2?: string };

export type FetchProductsOptions = InterfuerzaOptions;

/** R3.3 — `=` only, per spec; no `>=`/`LIKE` is needed for category passthrough. */
function buildFilters(filters: SyncFilters): FilterEntry[] {
  const entries: FilterEntry[] = [];
  if (filters.l1) {
    entries.push({ field: "Category_L1", type: "=", value: filters.l1 });
  }
  if (filters.l2) {
    entries.push({ field: "Category_L2", type: "=", value: filters.l2 });
  }
  return entries;
}

/**
 * Yields one page's raw product objects at a time so `job.ts` can persist
 * incrementally inside a single transaction: if this throws, nothing yielded
 * so far has been committed and the transaction rolls the run back (R1.9).
 *
 * Items are passed through verbatim — parsing them is `mapper.ts`'s job.
 */
export function fetchAllProducts(
  filters: SyncFilters = {},
  options: FetchProductsOptions = {},
): AsyncGenerator<unknown[]> {
  return fetchAllPages("products", "products", buildFilters(filters), options);
}
