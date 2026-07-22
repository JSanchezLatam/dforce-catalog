import { describe, expect, it, vi } from "vitest";

import { fetchAllProducts, MAX_ATTEMPTS, RATE_LIMIT_SPACING_MS, RETRY_INTERVAL_MS, SyncAbortError } from "./client";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("fetchAllProducts", () => {
  it("paginates sequentially and spaces requests by RATE_LIMIT_SPACING_MS (NFR-1)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: "1" }], hasNext: true }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: "2" }], hasNext: false }));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const pages: unknown[][] = [];
    for await (const page of fetchAllProducts(
      {},
      { fetchImpl, sleepImpl, baseUrl: "https://api.test", token: "t" },
    )) {
      pages.push(page);
    }

    expect(pages).toEqual([[{ id: "1" }], [{ id: "2" }]]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Exactly one inter-page sleep (between page 1 and 2) — none after the last page.
    expect(sleepImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).toHaveBeenCalledWith(RATE_LIMIT_SPACING_MS);
  });

  it("sends X-IFX-Token and passes the L1 filter through as a query param (R3.3)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [], hasNext: false }));

    const generator = fetchAllProducts(
      { l1: "Motor" },
      { fetchImpl, sleepImpl: vi.fn(), baseUrl: "https://api.test", token: "secret-token" },
    );
    await generator.next();

    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(init.headers).toMatchObject({ "X-IFX-Token": "secret-token" });
    expect(url.searchParams.get("category_l1")).toBe("Motor");
    expect(url.searchParams.get("size")).toBe("25");
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
});
