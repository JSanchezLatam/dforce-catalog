import { describe, expect, it } from "vitest";

import { buildIndexRows, type CatalogIndexSection, type ProductPrintRef } from "./CatalogTemplate";
import { FIRST_PRODUCT_PAGE_NUMBER } from "./page-geometry";

const section = (categoryL1: string, categoryL2: string | null, productCount: number): CatalogIndexSection => ({
  categoryL1,
  categoryL2,
  productCount,
});

const product = (id: string, categoryL1: string | null): ProductPrintRef => ({
  id,
  name: `Product ${id}`,
  categoryL1,
  categoryL2: null,
});

/**
 * The index arrives as one section per L1/L2 pair but prints as one row per
 * L1, so the collapse is the only place a category can go missing, get counted
 * twice, or be pointed at the wrong page.
 */
describe("buildIndexRows — collapsing sections into the printed index", () => {
  it("prints one row per L1, summing the counts and listing the L2s beneath it", () => {
    const rows = buildIndexRows([
      section("ELECTRÓNICA", "Amplificadores", 120),
      section("ELECTRÓNICA", "Tweeters", 60),
      section("ACCESORIOS", "Forros", 94),
    ]);

    expect(rows).toEqual([
      { categoryL1: "ELECTRÓNICA", subcategories: ["Amplificadores", "Tweeters"], productCount: 180, pageNumber: null },
      { categoryL1: "ACCESORIOS", subcategories: ["Forros"], productCount: 94, pageNumber: null },
    ]);
  });

  it("keeps the section order rather than sorting — the index must match the page order", () => {
    const rows = buildIndexRows([section("ZETA", null, 1), section("ALFA", null, 1)]);
    expect(rows.map((row) => row.categoryL1)).toEqual(["ZETA", "ALFA"]);
  });

  it("drops empty sections instead of printing a category with nothing behind it", () => {
    const rows = buildIndexRows([section("VACÍA", null, 0), section("LLENA", null, 3)]);
    expect(rows.map((row) => row.categoryL1)).toEqual(["LLENA"]);
  });

  it("lists a repeated L2 once", () => {
    const [row] = buildIndexRows([section("AUDIO", "Bocinas", 2), section("AUDIO", "Bocinas", 3)]);
    expect(row?.subcategories).toEqual(["Bocinas"]);
  });

  /**
   * The page number cannot be counted from the product counts: the packer
   * splits by MEASURED card height, so a category's span is only known once
   * the pages exist. It has to be read off where the products actually landed.
   */
  it("points each category at the page its first product actually landed on", () => {
    const rows = buildIndexRows(
      [section("AUDIO", null, 3), section("LUCES", null, 1)],
      [
        [product("a1", "AUDIO"), product("a2", "AUDIO")],
        [product("a3", "AUDIO")],
        [product("l1", "LUCES")],
      ],
    );

    expect(rows.map((row) => row.pageNumber)).toEqual([FIRST_PRODUCT_PAGE_NUMBER, FIRST_PRODUCT_PAGE_NUMBER + 2]);
  });

  it("leaves the page number null when there are no product pages (the builder preview)", () => {
    const [row] = buildIndexRows([section("AUDIO", null, 3)]);
    expect(row?.pageNumber).toBeNull();
  });

  it("leaves the page number null for a category no page carries", () => {
    const [, row] = buildIndexRows(
      [section("AUDIO", null, 1), section("HUÉRFANA", null, 1)],
      [[product("a1", "AUDIO")]],
    );
    expect(row?.pageNumber).toBeNull();
  });
});
