import { describe, expect, it, vi } from "vitest";

import { fetchAllProducts, MAX_ATTEMPTS, PAGE_SIZE, RATE_LIMIT_SPACING_MS, RETRY_INTERVAL_MS, SyncAbortError } from "./client";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

function productsPage(count: number, total: number): { products: unknown[]; count: number } {
  const products = Array.from({ length: count }, (_, i) => ({ Producto: { id: String(i) } }));
  return { products, count: total };
}

describe("fetchAllProducts", () => {
  it("POSTs directly to IFX_BASE_URL with the class/action/page/X-IFX-Token contract", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(productsPage(0, 0)));

    const generator = fetchAllProducts(
      {},
      { fetchImpl, sleepImpl: vi.fn(), baseUrl: "https://api.test/v4/", token: "secret-token" },
    );
    await generator.next();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/v4/");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-IFX-Token": "secret-token",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      class: "GET",
      action: "products",
      page: "1",
    });
  });

  it("paginates sequentially and stops on the count-based terminus, spacing requests by RATE_LIMIT_SPACING_MS", async () => {
    // count=60 stable grand total: pages of 25/25/10 (R1.1)
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(productsPage(25, 60)))
      .mockResolvedValueOnce(jsonResponse(productsPage(25, 60)))
      .mockResolvedValueOnce(jsonResponse(productsPage(10, 60)));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const pages: unknown[][] = [];
    for await (const page of fetchAllProducts(
      {},
      { fetchImpl, sleepImpl, baseUrl: "https://api.test", token: "t" },
    )) {
      pages.push(page);
    }

    expect(pages.map((p) => p.length)).toEqual([25, 25, 10]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // Exactly two inter-page sleeps (1->2, 2->3) — none after the last page.
    expect(sleepImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledWith(RATE_LIMIT_SPACING_MS);
  });

  it("stops after exactly 2 pages when count is an exact multiple of PAGE_SIZE (no wasted 3rd call)", async () => {
    // count=50 -> page1: 1*25=25<50 continue; page2: 2*25=50>=50 stop.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(productsPage(25, 50)))
      .mockResolvedValueOnce(jsonResponse(productsPage(25, 50)));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const pages: unknown[][] = [];
    for await (const page of fetchAllProducts(
      {},
      { fetchImpl, sleepImpl, baseUrl: "https://api.test", token: "t" },
    )) {
      pages.push(page);
    }

    expect(pages.map((p) => p.length)).toEqual([25, 25]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });

  it("stops on a partial last page (count=37 -> page1=25, page2=12)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(productsPage(25, 37)))
      .mockResolvedValueOnce(jsonResponse(productsPage(12, 37)));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const pages: unknown[][] = [];
    for await (const page of fetchAllProducts(
      {},
      { fetchImpl, sleepImpl, baseUrl: "https://api.test", token: "t" },
    )) {
      pages.push(page);
    }

    expect(pages.map((p) => p.length)).toEqual([25, 12]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("passes yielded products through unchanged — no reshaping/parsing in client.ts", async () => {
    const rawProduct = { Producto: { id: "1" }, InStock: [], PriceLists: [], Images: [], Matrix: [] };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ products: [rawProduct], count: 1 }));

    const generator = fetchAllProducts(
      {},
      { fetchImpl, sleepImpl: vi.fn(), baseUrl: "https://api.test", token: "t" },
    );
    const { value } = await generator.next();

    expect(value).toEqual([rawProduct]);
  });

  it("builds the filters array only when a category filter is active (R3.3)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(productsPage(0, 0)));

    const generator = fetchAllProducts(
      { l1: "HOGAR", l2: "COCINA" },
      { fetchImpl, sleepImpl: vi.fn(), baseUrl: "https://api.test", token: "t" },
    );
    await generator.next();

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      class: "GET",
      action: "products",
      page: "1",
      filters: [
        { field: "Category_L1", type: "=", value: "HOGAR" },
        { field: "Category_L2", type: "=", value: "COCINA" },
      ],
    });
  });

  it("omits the filters key entirely when no category filter is active", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(productsPage(0, 0)));

    const generator = fetchAllProducts(
      {},
      { fetchImpl, sleepImpl: vi.fn(), baseUrl: "https://api.test", token: "t" },
    );
    await generator.next();

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty("filters");
  });

  it("retries a failing page up to MAX_ATTEMPTS then aborts without ever yielding it (R1.8/R1.9)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(null, false, 500));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const iterator = fetchAllProducts(
      {},
      { fetchImpl, sleepImpl, baseUrl: "https://api.test", token: "t" },
    );

    await expect(iterator.next()).rejects.toBeInstanceOf(SyncAbortError);
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    // Retry spacing (60s) between attempts on the SAME page — distinct from
    // the 500ms inter-page spacing asserted above.
    expect(sleepImpl).toHaveBeenCalledTimes(MAX_ATTEMPTS - 1);
    expect(sleepImpl).toHaveBeenCalledWith(RETRY_INTERVAL_MS);
  });

  it("throws a clear error instead of calling the API when IFX_TOKEN/IFX_BASE_URL are unset", async () => {
    const iterator = fetchAllProducts({}, { fetchImpl: vi.fn(), sleepImpl: vi.fn() });
    await expect(iterator.next()).rejects.toThrow(/IFX_TOKEN|IFX_BASE_URL/);
  });

  it("PAGE_SIZE constant is still 25 (pagination math relies on this)", () => {
    expect(PAGE_SIZE).toBe(25);
  });
});

/**
 * Added AFTER the extraction, and deliberately breaking this file's
 * "untouched" status — because the thing it was proving stopped being true.
 *
 * `design.md` D1 claimed these tests passing unmodified proved the refactor
 * changed no behaviour. That held for the extraction commit. It stopped
 * holding when a later commit added a `count` guard INSIDE the shared
 * transport: every fixture here hands back a numeric `count`, so a guard that
 * rejected the string the API actually sends was invisible to all of them.
 *
 * An untouched test file is proof only while nothing underneath it changed.
 */
describe("fetchAllProducts — the wire shape of `count` (post-extraction)", () => {
  it("paginates on the numeric STRING the API really sends", async () => {
    // Measured live: products answers `count: "699"`, a string, exactly as
    // customers answers `"370"`. The pre-extraction code worked by coercion.
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ products: Array.from({ length: 25 }, (_, i) => ({ Producto: { id: String(i) } })), count: "60" }),
    })) as unknown as typeof fetch;
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const batches: unknown[][] = [];
    for await (const batch of fetchAllProducts({}, { fetchImpl, sleepImpl, baseUrl: "https://ifx.test/", token: "t" })) {
      batches.push(batch);
      if (batches.length > 5) break; // a guard against a regression that loops
    }

    // 60 over pages of 25 → 3 pages. A guard rejecting the string would have
    // aborted here instead, on the very first page.
    expect(batches).toHaveLength(3);
  });
});
