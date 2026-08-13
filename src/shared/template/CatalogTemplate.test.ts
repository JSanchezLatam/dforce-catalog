import { describe, expect, it } from "vitest";

import { buildIndex, type CatalogIndexSection, type ProductPrintRef } from "./CatalogTemplate";
import { INDEX_ROWS_PER_PAGE, firstProductPageNumber, indexPageCount } from "./page-geometry";

const FIRST_PRODUCT_PAGE_NUMBER = firstProductPageNumber(1);

/** The index's rows, flattened back out of its sheets. */
const rowsOf = (...args: Parameters<typeof buildIndex>) => buildIndex(...args).pages.flat();

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
    const rows = rowsOf([
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
    const rows = rowsOf([section("ZETA", null, 1), section("ALFA", null, 1)]);
    expect(rows.map((row) => row.categoryL1)).toEqual(["ZETA", "ALFA"]);
  });

  it("drops empty sections instead of printing a category with nothing behind it", () => {
    const rows = rowsOf([section("VACÍA", null, 0), section("LLENA", null, 3)]);
    expect(rows.map((row) => row.categoryL1)).toEqual(["LLENA"]);
  });

  it("lists a repeated L2 once", () => {
    const [row] = rowsOf([section("AUDIO", "Bocinas", 2), section("AUDIO", "Bocinas", 3)]);
    expect(row?.subcategories).toEqual(["Bocinas"]);
  });

  /**
   * The page number cannot be counted from the product counts: the packer
   * splits by MEASURED card height, so a category's span is only known once
   * the pages exist. It has to be read off where the products actually landed.
   */
  it("points each category at the page its first product actually landed on", () => {
    const rows = rowsOf(
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
    const [row] = rowsOf([section("AUDIO", null, 3)]);
    expect(row?.pageNumber).toBeNull();
  });

  it("leaves the page number null for a category no page carries", () => {
    const [, row] = rowsOf(
      [section("AUDIO", null, 1), section("HUÉRFANA", null, 1)],
      [[product("a1", "AUDIO")]],
    );
    expect(row?.pageNumber).toBeNull();
  });
});

/**
 * A `Sheet` is an absolutely-positioned box of exactly one page, so page
 * breaking cannot reach inside it to split a long table. An index longer than
 * one sheet has to be chunked, or its extra categories render over the footer
 * band and off the bottom of the paper — losing them with no error, no failing
 * test, and nothing visible to whoever generated the catalog.
 */
describe("buildIndex — an index longer than one sheet", () => {
  const manySections = (count: number) =>
    Array.from({ length: count }, (_, at) => section(`CATEGORÍA ${at}`, null, 1));

  it("keeps a full sheet's worth of categories on one sheet", () => {
    const pages = buildIndex(manySections(INDEX_ROWS_PER_PAGE)).pages;
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(INDEX_ROWS_PER_PAGE);
  });

  it("spills onto a second sheet rather than off the bottom of the first", () => {
    const pages = buildIndex(manySections(INDEX_ROWS_PER_PAGE + 1)).pages;
    expect(pages).toHaveLength(2);
    expect(pages[1]).toHaveLength(1);
  });

  it("still prints one sheet when there are no categories at all", () => {
    expect(buildIndex([]).pages).toEqual([[]]);
  });

  /**
   * The number the index PRINTS beside a category has to be the number that
   * category's page prints in its own footer. A second index sheet pushes every
   * product page down by one, so a page number counted as a constant `3` would
   * send the reader one page short of what they are looking for.
   */
  it("shifts the product page numbers down when the index itself needs a second sheet", () => {
    const sections = manySections(INDEX_ROWS_PER_PAGE + 1);
    const first = sections[0];
    if (!first) throw new Error("fixture");

    const rows = rowsOf(sections, [[product("p1", first.categoryL1)]]);

    expect(indexPageCount(sections.length)).toBe(2);
    expect(rows[0]?.pageNumber).toBe(firstProductPageNumber(2));
    expect(rows[0]?.pageNumber).toBe(FIRST_PRODUCT_PAGE_NUMBER + 1);
  });
});
