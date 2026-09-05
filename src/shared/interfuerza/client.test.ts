import { describe, expect, it, vi } from "vitest";

import { fetchAllPages, InterfuerzaAbortError, MAX_ATTEMPTS, PAGE_SIZE } from "./client";

const OPTS = { baseUrl: "https://ifx.test/api/v4/", token: "t" };

/** One page envelope. `count` is the GRAND TOTAL, not this page's length. */
function page(listKey: string, rows: unknown[], count: number) {
  return { ok: true, status: 200, json: async () => ({ [listKey]: rows, count }) } as Response;
}

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({ i }));
}

async function drain(gen: AsyncGenerator<unknown[]>) {
  const out: unknown[][] = [];
  for await (const batch of gen) out.push(batch);
  return out;
}

/**
 * These cover what only the SHARED client can be asked — the two parameters
 * that exist because it has more than one caller. Pagination through the
 * products path is already covered by `inventory-sync/client.test.ts`, which
 * this extraction left untouched; duplicating it here would add nothing.
 */
describe("fetchAllPages — the parameters that exist because there are two callers", () => {
  it("sends the action it was given, not a hardcoded one", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page("customers", rows(1), 1));

    await drain(fetchAllPages("customers", "customers", [], { ...OPTS, fetchImpl }));

    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.action).toBe("customers");
    expect(body.class).toBe("GET");
    expect(body.page).toBe("1");
  });

  it("reads the rows from the list key it was given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page("customers", rows(3), 3));

    const batches = await drain(fetchAllPages("customers", "customers", [], { ...OPTS, fetchImpl }));

    expect(batches).toEqual([rows(3)]);
  });

  // The failure this guards: a list key that does not match the envelope used
  // to make `result[listKey]` `undefined`, and iterating `undefined` throws
  // deep inside the caller's mapper rather than here.
  it("yields an empty batch when the list key is absent, instead of undefined", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ somethingElse: rows(3), count: 3 }),
    } as Response);

    const batches = await drain(fetchAllPages("customers", "customers", [], { ...OPTS, fetchImpl }));

    expect(batches).toEqual([[]]);
  });

  it("omits `filters` entirely when none are given, matching the live contract", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page("customers", rows(1), 1));

    await drain(fetchAllPages("customers", "customers", [], { ...OPTS, fetchImpl }));

    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty("filters");
  });

  it("includes `filters` when given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page("products", rows(1), 1));
    const filters = [{ field: "Category_L1", type: "=" as const, value: "Aceites" }];

    await drain(fetchAllPages("products", "products", filters, { ...OPTS, fetchImpl }));

    expect(JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string).filters).toEqual(filters);
  });
});

describe("fetchAllPages — the rules that carry an IP-ban risk", () => {
  // `count` is the grand total, so the end is arithmetic. Keyed on
  // `rows.length < PAGE_SIZE` instead, an exact multiple of the page size
  // costs a wasted terminal request against a ~20 req/10s limit.
  it("stops at page * PAGE_SIZE >= count, with no wasted terminal request", async () => {
    const total = PAGE_SIZE * 2; // an exact multiple: the trap case
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(page("customers", rows(PAGE_SIZE), total))
      .mockResolvedValueOnce(page("customers", rows(PAGE_SIZE), total))
      .mockResolvedValue(page("customers", [], total));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const batches = await drain(fetchAllPages("customers", "customers", [], { ...OPTS, fetchImpl, sleepImpl }));

    expect(batches).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("sleeps between pages and never issues them concurrently", async () => {
    const order: string[] = [];
    let call = 0;
    // BOUNDED on purpose. An earlier version returned a full page forever and
    // relied on the `count` arithmetic to stop it — so a mutation that broke
    // that arithmetic HUNG the worker for 32s instead of failing, which hid
    // the clean assertion in the test above behind an "Errors 1" line.
    // A test must fail, not hang.
    const fetchImpl = vi.fn(async () => {
      order.push("fetch");
      call += 1;
      return page("customers", call === 1 ? rows(PAGE_SIZE) : rows(1), PAGE_SIZE * 2);
    });
    const sleepImpl = vi.fn(async () => {
      order.push("sleep");
    });

    await drain(fetchAllPages("customers", "customers", [], { ...OPTS, fetchImpl, sleepImpl }));

    // fetch → sleep → fetch. A `Promise.all` over pages would show two
    // adjacent fetches, which is the shape that trips the rate limit.
    expect(order).toEqual(["fetch", "sleep", "fetch"]);
  });

  it("aborts the whole run after MAX_ATTEMPTS on one page, rather than skipping it", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network"));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const gen = fetchAllPages("customers", "customers", [], { ...OPTS, fetchImpl, sleepImpl });

    await expect(gen.next()).rejects.toBeInstanceOf(InterfuerzaAbortError);
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it("treats a non-2xx response as a failed attempt, not as an empty page", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response);
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchAllPages("clients", "clients", [], { ...OPTS, fetchImpl, sleepImpl }).next(),
    ).rejects.toBeInstanceOf(InterfuerzaAbortError);
    // `clients` really does answer 401 on the live API — an empty page here
    // would import nothing and report success.
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });
});

describe("fetchAllPages — refuses to call without credentials", () => {
  it("throws for a missing token before any request", async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchAllPages("customers", "customers", [], { baseUrl: "https://ifx.test/", token: "", fetchImpl }).next(),
    ).rejects.toThrow(/IFX_TOKEN/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws for a missing base URL before any request", async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchAllPages("customers", "customers", [], { baseUrl: "", token: "t", fetchImpl }).next(),
    ).rejects.toThrow(/IFX_BASE_URL/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

/**
 * The envelope is `await response.json()`, so `count: number` is a CLAIM, not
 * a fact — the same reason `service-orders/service.ts` validates `categoria`
 * rather than trusting its type. The extraction hardened the list key and left
 * `count` alone.
 *
 * The two malformed shapes fail in OPPOSITE directions, which is why one guard
 * has to cover both:
 *   - `undefined` — `25 >= undefined` is false, forever. No page cap, no retry
 *     ceiling (the budget only covers a FAILING page and every one of these
 *     succeeds), so it hammers an API with a documented ~20 req/10s limit and
 *     a real 1-hour ban.
 *   - `null` — `25 >= null` is TRUE, because null coerces to 0. It stops after
 *     page one, imports 25 of 370, and reports success.
 *
 * `tasks.md` WU1.5 recorded "a test must fail, not hang" about a fetch MOCK.
 * The production loop had the same shape and nobody looked.
 */
describe("fetchAllPages — a `count` the envelope did not actually provide", () => {
  it("aborts instead of looping forever when `count` is missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ customers: rows(PAGE_SIZE) }), // no `count`
    } as Response);
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const gen = fetchAllPages("customers", "customers", [], { ...OPTS, fetchImpl, sleepImpl });
    await gen.next(); // the first page still yields
    await expect(gen.next()).rejects.toBeInstanceOf(InterfuerzaAbortError);

    // The point is the bound: without it this number is unbounded.
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("aborts instead of silently importing one page when `count` is null", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ customers: rows(PAGE_SIZE), count: null }),
    } as Response);

    const gen = fetchAllPages("customers", "customers", [], { ...OPTS, fetchImpl });
    await gen.next();
    // `25 >= null` is true, so the un-guarded version ENDED here and reported
    // a complete run over 25 of 370 customers.
    await expect(gen.next()).rejects.toBeInstanceOf(InterfuerzaAbortError);
  });

  it("still accepts a legitimate count of 0", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page("customers", [], 0));

    expect(await drain(fetchAllPages("customers", "customers", [], { ...OPTS, fetchImpl }))).toEqual([[]]);
  });
});
