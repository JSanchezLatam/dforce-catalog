import { describe, expect, it, vi } from "vitest";

import { fetchAllCustomers } from "./client";

const OPTS = { baseUrl: "https://ifx.test/api/v4/", token: "t" };

function page(rows: unknown[], count: number) {
  return { ok: true, status: 200, json: async () => ({ customers: rows, count }) } as Response;
}

async function drain(gen: AsyncGenerator<unknown[]>) {
  const out: unknown[][] = [];
  for await (const batch of gen) out.push(batch);
  return out;
}

/**
 * Thin by design, so this covers exactly the two things it decides — and they
 * are the two that fail SILENTLY when wrong: a wrong action returns 401 or an
 * empty list, and a wrong list key yields no rows. Either way the import
 * finishes and reports success having imported nobody.
 */
describe("fetchAllCustomers", () => {
  it("asks for the `customers` action — the only one that works", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page([{ Cliente: "1" }], 1));

    await drain(fetchAllCustomers({ ...OPTS, fetchImpl }));

    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    // `clients`/`client` answer 401 and `contacts` answers an empty list, so
    // none of them would surface as an obvious failure here.
    expect(body.action).toBe("customers");
  });

  it("reads the rows Interfuerza actually returns", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page([{ Cliente: "1" }, { Cliente: "2" }], 2));

    expect(await drain(fetchAllCustomers({ ...OPTS, fetchImpl }))).toEqual([[{ Cliente: "1" }, { Cliente: "2" }]]);
  });

  // 370 over 25 is 14.8 pages: the live shape, and the one where an
  // off-by-one drops the last 20 customers.
  it("pages through a 370-row total exactly, without a wasted final request", async () => {
    const fetchImpl = vi.fn(async () => page(Array.from({ length: 25 }, (_, i) => ({ i })), 370));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const batches = await drain(fetchAllCustomers({ ...OPTS, fetchImpl, sleepImpl }));

    expect(batches).toHaveLength(15);
    expect(fetchImpl).toHaveBeenCalledTimes(15);
  });

  it("sends no filters — the import takes every customer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page([], 0));

    await drain(fetchAllCustomers({ ...OPTS, fetchImpl }));

    expect(JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)).not.toHaveProperty("filters");
  });
});
