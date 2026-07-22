import { env } from "@/shared/config/env";

/**
 * Interfuerza API client (R1.7/1.8, NFR-1 — see design.md → "Interfuerza API
 * Client").
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

export type SyncFilters = { l1?: string };

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

type ProductsPage = { items: unknown[]; hasNext: boolean };

const defaultSleep: SleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(
  page: number,
  filters: SyncFilters,
  fetchImpl: FetchImpl,
  baseUrl: string,
  token: string,
): Promise<ProductsPage> {
  const url = new URL("/products", baseUrl);
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(PAGE_SIZE));
  if (filters.l1) {
    // R3.3 — category filter passthrough on the next filtered sync call.
    url.searchParams.set("category_l1", filters.l1);
  }

  const response = await fetchImpl(url, { headers: { "X-IFX-Token": token } });
  if (!response.ok) {
    throw new Error(`Interfuerza API responded with HTTP ${response.status} for page ${page}`);
  }
  return (await response.json()) as ProductsPage;
}

async function fetchPageWithRetry(
  page: number,
  filters: SyncFilters,
  fetchImpl: FetchImpl,
  sleepImpl: SleepImpl,
  baseUrl: string,
  token: string,
): Promise<ProductsPage> {
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
 * Yields one page's raw items at a time so the caller (job.ts) can persist
 * incrementally inside a single DB transaction: if this generator throws
 * (page exhausted its retries), nothing yielded so far has been committed
 * yet, and the transaction rolls back the entire run (R1.9).
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
  let hasNext = true;
  while (hasNext) {
    const result = await fetchPageWithRetry(page, filters, fetchImpl, sleepImpl, baseUrl, token);
    yield result.items;
    hasNext = result.hasNext;
    page++;
    if (hasNext) {
      // ponytail: a plain awaited setTimeout is enough to satisfy NFR-1's
      // fixed 500ms spacing — no rate-limiting library needed for one
      // strictly sequential loop.
      await sleepImpl(RATE_LIMIT_SPACING_MS);
    }
  }
}
