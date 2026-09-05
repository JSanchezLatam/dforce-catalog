import { env } from "@/shared/config/env";

/**
 * The Interfuerza v4 transport, shared by every caller.
 *
 * Extracted from `inventory-sync/client.ts` when a second caller
 * (`customer-import`) appeared. It was NOT copied, and the reason is
 * specific: the retry and spacing rules below carry a real 1-hour IP ban risk
 * (~20 requests / 10 seconds), and `InterfuerzaAbortError`'s meaning — abort
 * the WHOLE run and keep prior DB state, never "skip this page" — is the kind
 * of subtlety a second copy loses quietly.
 *
 * The contract itself, verified by live smoke tests rather than vendor docs
 * (which described a REST API that does not exist):
 *
 *  - a SINGLE endpoint: POST to `IFX_BASE_URL` with no path appended
 *  - body `{class: "GET", action, page, filters?}`
 *  - auth via the `X-IFX-Token` header
 *  - the response's `count` is a STABLE GRAND TOTAL across every page, so
 *    pagination ends at `page * PAGE_SIZE >= count` — exact, and it avoids a
 *    wasted terminal request when the total is an exact multiple of the page
 *    size. Confirmed for `products` (pages 1/2/28/29) and again for
 *    `customers` (count 370 across all 15 pages).
 *
 * Strictly SEQUENTIAL, awaited pagination — NEVER `Promise.all` over pages.
 */

export const PAGE_SIZE = 25;
export const RATE_LIMIT_SPACING_MS = 500;
export const MAX_ATTEMPTS = 3;
export const RETRY_INTERVAL_MS = 60_000;

/**
 * Thrown after `MAX_ATTEMPTS` failed attempts on the same page. Every caller
 * MUST treat this as "abort the whole run, keep prior DB state", never as
 * "skip this page" — a partial import is worse than none, because nobody can
 * tell which half is missing.
 */
export class InterfuerzaAbortError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    // Matches the class. It used to read "SyncAbortError", which put
    // inventory-sync's vocabulary into every customer-import log line and
    // stack trace — the same misdirection the `R1.9` citation was removed
    // from the message for. Nothing reads `.name`; both callers use
    // `instanceof`, and `inventory-sync` re-exports this class under its old
    // NAME, which is what keeps those checks working.
    this.name = "InterfuerzaAbortError";
  }
}

export type FilterEntry = { field: string; type: "=" | ">="; value: string };

type FetchImpl = typeof fetch;
type SleepImpl = (ms: number) => Promise<void>;

export type InterfuerzaOptions = {
  /** Injectable for tests — defaults to the global `fetch`. */
  fetchImpl?: FetchImpl;
  /** Injectable for tests — defaults to a real `setTimeout` sleep. */
  sleepImpl?: SleepImpl;
  baseUrl?: string;
  token?: string;
};

const defaultSleep: SleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One page's raw envelope. The list lives under a key named after the action. */
type PageResult = { count: number } & Record<string, unknown>;

/**
 * Accepts what the API actually sends (a numeric string) and what a typed
 * fixture sends (a number). Everything else — absent, null, empty, or
 * non-numeric — is `null`, because each of those either loops forever or
 * silently truncates the run.
 */
function parseCount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchPage(
  action: string,
  page: number,
  filters: FilterEntry[],
  fetchImpl: FetchImpl,
  baseUrl: string,
  token: string,
): Promise<PageResult> {
  const body: Record<string, unknown> = { class: "GET", action, page: String(page) };
  // Only included when a filter is actually active — the live smoke test
  // confirmed the unfiltered call omits `filters` entirely.
  if (filters.length > 0) {
    body.filters = filters;
  }

  const response = await fetchImpl(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-IFX-Token": token },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Interfuerza API responded with HTTP ${response.status} for page ${page}`);
  }
  return (await response.json()) as PageResult;
}

async function fetchPageWithRetry(
  action: string,
  page: number,
  filters: FilterEntry[],
  fetchImpl: FetchImpl,
  sleepImpl: SleepImpl,
  baseUrl: string,
  token: string,
): Promise<PageResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchPage(action, page, filters, fetchImpl, baseUrl, token);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await sleepImpl(RETRY_INTERVAL_MS);
      }
    }
  }
  // No requirement id here. `R1.9` belongs to inventory-sync, and a
  // customer-import failure logging it sends whoever reads that line into the
  // wrong capability's spec. Each caller's docstring owns its own citation.
  throw new InterfuerzaAbortError(
    `Interfuerza \`${action}\` page ${page} failed after ${MAX_ATTEMPTS} attempts — aborting, prior DB state preserved`,
    lastError,
  );
}

/**
 * Yields one page's raw rows at a time so the caller can persist incrementally
 * inside a single transaction: if this generator throws, nothing yielded so
 * far has been committed and the transaction rolls the whole run back.
 *
 * Rows are passed through VERBATIM — reshaping them is each module's mapper's
 * job, not this file's.
 *
 * `listKey` is the response field holding the rows, and it is named after the
 * action (`products` → `products`, `customers` → `customers`). Passed
 * explicitly rather than derived, so a future action whose envelope does not
 * follow that convention is a parameter change and not a silent empty page.
 */
export async function* fetchAllPages(
  action: string,
  listKey: string,
  filters: FilterEntry[] = [],
  options: InterfuerzaOptions = {},
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
    const result = await fetchPageWithRetry(action, page, filters, fetchImpl, sleepImpl, baseUrl, token);
    const rows = result[listKey];
    yield Array.isArray(rows) ? rows : [];

    // MEASURED, not assumed: `count` arrives as a STRING on the wire —
    // `"370"` for customers and `"699"` for products, `typeof === "string"`
    // for both, confirmed by a live call. This API stringifies its numbers
    // generally (`mapper.ts` reads `Available: "-3.0000"`, prices arrive as
    // `"10.00"`), so a numeric `count` is the shape that never occurs.
    //
    // The original comparison worked by COERCION — `25 >= "370"` is false —
    // and a strict `typeof === "number"` guard would have aborted every run of
    // both callers on page one. That version shipped briefly; the mocks in
    // every test file handed back a numeric `count`, so nothing could see it.
    //
    // What the guard is actually for, since the type alone proves nothing:
    //   - `undefined` → `25 >= undefined` is false FOREVER. No page cap and no
    //     retry ceiling here (that budget covers a page that FAILS, and every
    //     one of these succeeds), so it hammers an API with a ~20 req/10s
    //     limit and a real 1-hour ban.
    //   - `null` and `""` → both coerce to 0, so the loop stops after page
    //     one, imports 25 of 370, and reports success.
    //
    // Abort rather than `break`: a run that ends early and calls itself
    // complete is the "imports nobody, reports success" failure the customers
    // client's docstring names. A genuine `0` still passes.
    const total = parseCount(result.count);
    if (total === null) {
      throw new InterfuerzaAbortError(
        `Page ${page} returned an envelope with no usable count — aborting, prior DB state preserved`,
      );
    }

    const done = page * PAGE_SIZE >= total;
    if (done) {
      break;
    }
    page++;
    // ponytail: a plain awaited setTimeout is enough for a fixed 500ms
    // spacing on one strictly sequential loop — no rate-limiting library.
    await sleepImpl(RATE_LIMIT_SPACING_MS);
  }
}
