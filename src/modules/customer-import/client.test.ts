import { describe, expect, it, vi } from "vitest";

import { fetchAllCustomers } from "./client";

const OPTS = { baseUrl: "https://ifx.test/api/v4/", token: "t" };

/**
 * `count` as a STRING, because that is what Interfuerza sends — measured live
 * as `"370"` for this action.
 *
 * The numeric version this replaces is why WU2d's strict-`typeof` guard was
 * invisible here: restoring that guard left all four tests green, in the one
 * module whose whole job is fetching those 370 customers. `tasks.md` WU2d.2
 * then claimed "fixtures now produce the wire shape by default", which was
 * true two files over and false in this one.
 */
function page(rows: unknown[], count: number) {
  return { ok: true, status: 200, json: async () => ({ customers: rows, count: String(count) }) } as Response;
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
    // BOUNDED, and for one reason only: so this can never HANG. An unbounded
    // mock returns a full page forever, which under a length-based
    // termination rule never satisfies `rows.length < PAGE_SIZE` and loops
    // until the worker dies — the lesson `tasks.md` WU1.5 recorded, which this
    // file then reproduced one commit later.
    //
    // What this does NOT do is prove the termination rule, and saying so
    // matters more than the fix: 370 is 14 full pages plus a 20-row
    // remainder, so `page * PAGE_SIZE >= count` and `rows.length < PAGE_SIZE`
    // BOTH stop at page 15. Measured — with the rule mutated, this file still
    // passes 4/4. The rule is proven in `shared/interfuerza/client.test.ts`,
    // against an exact multiple of the page size, which is the only shape
    // where the two rules disagree.
    //
    // This test's job is the realistic arithmetic: 370 rows must arrive as 15
    // pages, not 14.
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      const size = call <= 14 ? 25 : call === 15 ? 20 : 0;
      return page(Array.from({ length: size }, (_, i) => ({ i })), 370);
    });
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
