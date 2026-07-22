import { env } from "@/shared/config/env";

/**
 * Interfuerza API client (R1.1/1.3-9, R3.3 — see design.md → "Interfuerza API
 * Client", contract VERIFIED via live smoke test, not just vendor docs).
 *
 * The real contract is a SINGLE endpoint: POST directly to `IFX_BASE_URL`
 * (no `/products` or any other path appended) with a JSON body describing
 * the desired action. The response's `count` field is a STABLE GRAND TOTAL
 * across every page (confirmed empirically: page 1 and the last page both
 * report the same `count`), so pagination end is computed as
 * `page * PAGE_SIZE >= count` rather than inspecting `products.length` —
 * this is more precise and avoids a wasted extra HTTP call when the total
 * is an exact multiple of `PAGE_SIZE`.
 *
 * Strictly SEQUENTIAL, awaited pagination — NEVER `Promise.all` over pages.
 * Concurrent requests risk tripping the API's ~20 req/10s rate limit, which
 * design.md flags as a real 1-hour IP ban risk. Every page waits for the
 * previous one to finish, then sleeps `RATE_LIMIT_SPACING_MS` before the next.
 */

export const PAGE_SIZE = 25;
export const RATE_LIMIT_SPACING_MS = 500;
export const MAX_ATTEMPTS = 3;
export const RETRY_INTERVAL_MS = 60_000;

export type SyncFilters = { l1?: string; l2?: string };

/** Thrown after `MAX_ATTEMPTS` failed attempts on the same page — the caller
 * (job.ts) MUST treat this as "abort the whole run, keep prior DB state"
 * (R1.9), never as "skip this page". */
export class SyncAbortError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SyncAbortError";
  }
}

type FetchImpl = typeof fetch;
type SleepImpl = (ms: number) => Promise<void>;

export type FetchProductsOptions = {
  /** Injectable for tests — defaults to the global `fetch`. */
  fetchImpl?: FetchImpl;
  /** Injectable for tests — defaults to a real `setTimeout` sleep. */
  sleepImpl?: SleepImpl;
  baseUrl?: string;
  token?: string;
};

/** Raw response shape for one page — `products` entries are passed through
 * unchanged; parsing/reshaping them is mapper.ts's job, not this file's. */
type FetchResult = { products: unknown[]; count: number };

const defaultSleep: SleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Builds the `filters` array entries (R3.3) — `=` only, per spec (no `>=`/`LIKE`
 * needed for category passthrough). */
function buildFilters(filters: SyncFilters): { field: string; type: "="; value: string }[] {
  const entries: { field: string; type: "="; value: string }[] = [];
  if (filters.l1) {
    entries.push({ field: "Category_L1", type: "=", value: filters.l1 });
  }
  if (filters.l2) {
    entries.push({ field: "Category_L2", type: "=", value: filters.l2 });
  }
  return entries;
}

async function fetchPage(
  page: number,
  filters: SyncFilters,
  fetchImpl: FetchImpl,
  baseUrl: string,
  token: string,
): Promise<FetchResult> {
  const filterEntries = buildFilters(filters);
  const body: Record<string, unknown> = {
    class: "GET",
    action: "products",
    page: String(page),
  };
  // Only included in the request when a category filter is actually active —
  // the live smoke test confirmed the unfiltered call omits `filters` entirely.
  if (filterEntries.length > 0) {
    body.filters = filterEntries;
  }

  const response = await fetchImpl(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-IFX-Token": token,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Interfuerza API responded with HTTP ${response.status} for page ${page}`);
  }
  return (await response.json()) as FetchResult;
}

async function fetchPageWithRetry(
  page: number,
  filters: SyncFilters,
  fetchImpl: FetchImpl,
  sleepImpl: SleepImpl,
  baseUrl: string,
  token: string,
): Promise<FetchResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchPage(page, filters, fetchImpl, baseUrl, token);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await sleepImpl(RETRY_INTERVAL_MS);
      }
    }
  }
  throw new SyncAbortError(
    `Page ${page} failed after ${MAX_ATTEMPTS} attempts — aborting sync, prior DB state preserved (R1.9)`,
    lastError,
  );
}

/**
 * Yields one page's raw product objects at a time so the caller (job.ts) can
 * persist incrementally inside a single DB transaction: if this generator
 * throws (page exhausted its retries), nothing yielded so far has been
 * committed yet, and the transaction rolls back the entire run (R1.9).
 *
 * Yielded items are passed through verbatim — parsing/reshaping each product
 * object is mapper.ts's responsibility, not this generator's.
 */
export async function* fetchAllProducts(
  filters: SyncFilters = {},
  options: FetchProductsOptions = {},
): AsyncGenerator<unknown[]> {
  const token = options.token ?? env.IFX_TOKEN;
  if (!token) {
    throw new Error("Missing IFX_TOKEN — cannot call Interfuerza API");
  }
  const baseUrl = options.baseUrl ?? env.IFX_BASE_URL;
  if (!baseUrl) {
    throw new Error("Missing IFX_BASE_URL — cannot call Interfuerza API");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? defaultSleep;

  let page = 1;
  while (true) {
    const result = await fetchPageWithRetry(page, filters, fetchImpl, sleepImpl, baseUrl, token);
    yield result.products;

    // count is a stable grand total (confirmed across pages 1/2/28/29 in the
    // live smoke test), so this is exact — no wasted terminal request on an
    // exact-PAGE_SIZE multiple.
    const done = page * PAGE_SIZE >= result.count;
    if (done) {
      break;
    }
    page++;
    // ponytail: a plain awaited setTimeout is enough to satisfy NFR-1's
    // fixed 500ms spacing — no rate-limiting library needed for one
    // strictly sequential loop.
    await sleepImpl(RATE_LIMIT_SPACING_MS);
  }
}
