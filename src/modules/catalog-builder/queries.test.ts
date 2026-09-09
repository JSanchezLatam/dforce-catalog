/**
 * `listProductsByIds` is the ONLY new SQL in `table-redesign-bulk-actions`
 * (design D10 point 2), and it must carry `listProductsInCategories`'
 * projection verbatim — `image` read out of `raw`, the `imageType` cast, and
 * the two-guard `priceLists` aggregate.
 *
 * AGENTS.md's injected-seam limit applies in full here: every test below
 * either injects the query function or reads the RENDERED SQL, so a green run
 * proves the projection's SHAPE and nothing about how Postgres answers it.
 * The real-database smoke test is task 7b.9 and is not optional.
 *
 * Reading the rendered SQL rather than trusting a shared constant is
 * deliberate: a future edit that gives `listProductsByIds` its own thinner
 * select compiles, passes type-checking, and silently degrades the review
 * step and the printed prices. Only the text of the emitted query catches it.
 */
import { describe, expect, it, vi } from "vitest";

import { listProductsByIds, productsByIdsQuery, productsInCategoriesQuery } from "./queries";
import { MAX_TOTAL_PRODUCTS, type ProductRef } from "./selection";

/** Everything the query SELECTs — the half before `from "producto"`. */
function projectionOf(query: { toSQL: () => { sql: string } }): string {
  const rendered = query.toSQL().sql;
  const end = rendered.indexOf(' from "producto"');
  // The `priceLists` aggregate has a `from jsonb_array_elements(...)` of its
  // own, so the split has to name the table rather than the keyword.
  expect(end).toBeGreaterThan(0);
  return rendered.slice(0, end);
}

const byIds = () => productsByIdsQuery(["PS0000001", "PS0000002"]);
const byCategories = () => productsInCategoriesQuery([{ categoryL1: "REPUESTOS" }]);

describe("listProductsByIds projection (design D10 point 2)", () => {
  it("selects exactly what listProductsInCategories selects, expression for expression", () => {
    expect(projectionOf(byIds())).toBe(projectionOf(byCategories()));
  });

  /**
   * The identity test above stays green if BOTH queries are thinned together,
   * which is the drift that costs the printed prices. These name the two
   * guards `listProductsInCategories` documents — a `jsonb_array_elements`
   * over a non-array RAISES, and `jsonb_object_agg` RAISES on a NULL key —
   * and the subquery runs per row, so either one aborts the read for every
   * user rather than dropping one product.
   */
  it.each([
    ["listProductsByIds", byIds],
    ["listProductsInCategories", byCategories],
  ])("%s keeps the container-type guard on the priceLists aggregate", (_name, build) => {
    expect(projectionOf(build())).toContain(`jsonb_typeof("raw"->'PriceLists') = 'array'`);
  });

  it.each([
    ["listProductsByIds", byIds],
    ["listProductsInCategories", byCategories],
  ])("%s keeps the NULL-key filter on the priceLists aggregate", (_name, build) => {
    expect(projectionOf(build())).toContain(`filter (where jsonb_typeof(pl->'Name') = 'string')`);
  });

  it.each([
    ["listProductsByIds", byIds],
    ["listProductsInCategories", byCategories],
  ])("%s reads image out of raw's first Images entry, trimmed and nullif'd", (_name, build) => {
    expect(projectionOf(build())).toContain(`trim(nullif("raw"->'Images'->0->>'src', ''))`);
  });
});

/**
 * Defence in depth beside `parseSeedProductIds`' cap on the URL: this route is
 * POST-able directly, so a hand-written body must not turn into an unbounded
 * `IN (...)`. The bind parameters of the rendered query are the only place
 * that is observable without a database.
 */
describe("listProductsByIds caps the id list server-side", () => {
  const oversized = Array.from({ length: MAX_TOTAL_PRODUCTS + 50 }, (_, i) => `PS${i}`);

  it("binds no more ids than the catalog cap allows", () => {
    expect(productsByIdsQuery(oversized).toSQL().params).toHaveLength(MAX_TOTAL_PRODUCTS);
  });

  it("keeps the first ids rather than an arbitrary window of them", () => {
    expect(productsByIdsQuery(oversized).toSQL().params).toEqual(oversized.slice(0, MAX_TOTAL_PRODUCTS));
  });

  it("leaves a legal-sized list untouched", () => {
    expect(productsByIdsQuery(["PS1", "PS2", "PS3"]).toSQL().params).toEqual(["PS1", "PS2", "PS3"]);
  });
});

describe("listProductsByIds resolution", () => {
  const found: ProductRef[] = [
    { id: "PS1", name: "Filtro", categoryL1: "REPUESTOS", categoryL2: null },
    { id: "PS3", name: "Correa", categoryL1: "REPUESTOS", categoryL2: null },
  ];

  /**
   * catalog-generation spec, "A stale id is dropped, not fabricated": the
   * handoff carries ids the ERP may have removed since. The builder proceeds
   * with what still exists and invents nothing for what does not — a
   * placeholder row here would print a nameless, priceless card.
   */
  it("returns only the rows the query produced, never one row per requested id", async () => {
    const rows = await listProductsByIds(["PS1", "PS2", "PS3"], async () => found);

    expect(rows).toEqual(found);
    expect(rows.map((r) => r.id)).not.toContain("PS2");
  });

  it("asks the database nothing for an empty id list", async () => {
    const queryFn = vi.fn(async () => found);

    expect(await listProductsByIds([], queryFn)).toEqual([]);
    expect(queryFn).not.toHaveBeenCalled();
  });
});
