import { fetchAllPages, type InterfuerzaOptions } from "@/shared/interfuerza/client";

/**
 * The customers half of the Interfuerza integration.
 *
 * Thin on purpose: pagination, the retry, the 500ms spacing and the abort
 * semantics all live in `shared/interfuerza/client.ts`, shared with
 * `inventory-sync`. What is specific here is only the action and its list key,
 * and both were established by a live sweep rather than by documentation:
 *
 *  - `customers` is the ONLY action that works. `clients` and `client` return
 *    **401**, `contacts` returns an empty list, and `customer` (singular)
 *    returns no list at all. Three of those four fail SILENTLY as far as a
 *    caller is concerned — an empty import that reports success.
 *  - the rows arrive under `customers`, and `count` (370 at the time of
 *    writing) is the stable grand total, so the shared `page * 25 >= count`
 *    rule applies unchanged.
 *
 * No filters: the import takes every customer. Interfuerza's filter grammar
 * supports `=`/`>=` only, and there is nothing to narrow by — `Status` is
 * `ACTIVE` on all 370 rows.
 */

export type FetchCustomersOptions = InterfuerzaOptions;

/** Yields one page's raw customer objects; reshaping them is `mapper.ts`'s job. */
export function fetchAllCustomers(options: FetchCustomersOptions = {}): AsyncGenerator<unknown[]> {
  return fetchAllPages("customers", "customers", [], options);
}
