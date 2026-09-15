import { describe, expect, it } from "vitest";

import { buildIndex, CatalogTemplate, MAX_FILLED_ROW_PX, type CatalogIndexSection, type ProductPrintRef } from "./CatalogTemplate";
import { INDEX_ROWS_PER_PAGE, firstProductPageNumber } from "./page-geometry";

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
describe("buildIndex — collapsing sections into the printed index", () => {
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

    expect(buildIndex(sections).pages).toHaveLength(2);
    expect(rows[0]?.pageNumber).toBe(firstProductPageNumber(2));
    expect(rows[0]?.pageNumber).toBe(FIRST_PRODUCT_PAGE_NUMBER + 1);
  });
});

/**
 * The product grid's vertical space: how the page's leftover height is spread,
 * and how far a row is allowed to grow into it. The full argument lives beside
 * the grid in `CatalogTemplate.tsx`.
 *
 * jsdom has NO layout engine, so nothing here proves the page looks right, or
 * that a row does not overflow, or that a card is not clipped — it can only
 * pin the declarations that decide those things in a real browser. Every
 * number quoted below was measured in a print-media Chromium; the standing
 * gate is `scripts/preview-catalog.ts`, whose `assertFilledRowsAreHonest`
 * step renders the mixed-height page real catalog data never produces.
 */
describe("the product grid — the page's leftover height", () => {
  const gridStyle = async (productCount: number, fillPageHeight?: boolean): Promise<string> => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const markup = renderToStaticMarkup(
      CatalogTemplate({
        title: "Cat\u00e1logo",
        branding: null,
        sections: [],
        productPages: [Array.from({ length: productCount }, (_, at) => product(String(at), "MOTOR"))],
        fillPageHeight,
      }),
    );
    return markup.match(/<div data-product-grid="" style="([^"]*)"/)?.[1] ?? "";
  };

  it("spreads the leftover height evenly around the rows instead of leaving it all at the bottom", async () => {
    expect(await gridStyle(6, true)).toContain("align-content:space-evenly");
  });

  /**
   * The measuring pass's grid must stay byte-for-byte what it was before
   * filling existed. `worker.ts` measures every card in ONE grid and
   * `chunkProducts` packs pages from those heights, so ANY declaration that
   * resizes a row there changes the numbers the packer splits against —
   * silently, in a PDF a customer reads.
   *
   * Asserted as the whole string rather than a list of absences: the previous
   * version checked for `stretch` and `grid-auto-rows` by name, which is a
   * list that only ever grows, and would have missed the `height` below.
   *
   * (`worker.test.ts` holds the other half: that the measuring pass never
   * passes the flag in the first place. Both are needed — this one alone would
   * pass on a worker that turned filling on for both passes.)
   */
  it("leaves the measuring pass's grid exactly as it was — that is what the packer splits against", async () => {
    expect(await gridStyle(6)).toBe(
      "display:grid;grid-template-columns:repeat(2, 1fr);gap:14px;min-height:100%;align-content:space-evenly",
    );
  });

  /**
   * What actually bounds the growth, and the bug this replaced.
   *
   * The first version sized rows with `grid-auto-rows: minmax(auto, N)` over a
   * `min-height` box and derived N from the page's ROW COUNT. Both halves were
   * wrong, and Chromium says so:
   *
   *   - `min-height` leaves the grid's block size INDEFINITE, and an indefinite
   *     grid grows every track to its growth limit whatever the page has left.
   *     The row count was doing the bounding, and a row count only bounds the
   *     total if every row is under N.
   *   - `height: 100%` against `ContentBox`'s definite 760px makes the free
   *     space real: tracks grow by what is actually spare and stop. Measured,
   *     8 short cards: rows 107 natural -> 180 filled, grid exactly 760.
   *
   * So the bound is the page itself, not arithmetic over a count — which is
   * why no N is computed here any more.
   */
  it("bounds the growth with the page's own free space, not with a row count", async () => {
    const style = await gridStyle(8, true);
    expect(style).toContain("height:100%");
    expect(style).not.toContain("min-height:100%");
  });

  /**
   * The floor, and the defect that made this test exist.
   *
   * `minmax(auto, 180px)` reads like "never below the natural card" and is not
   * reliably that: a grid item's AUTOMATIC minimum size is qualified by its
   * overflow and by percentage sizing, and the card sets both (`height: 100%`,
   * `overflow: hidden`). Measured on the shipped grid, a naturally 217px card
   * rendered at 179px with its price rows scrolled out of that hidden overflow
   * — not an overflow, a silently truncated product in a printed catalogue,
   * which is worse.
   *
   * Stated exactly, because overclaiming here is what shipped it: with the
   * DEFINITE height the test above pins, `auto` stopped clipping in the same
   * probe. `min-content` is kept anyway — it is the floor whose meaning does
   * not depend on how a browser resolves an automatic minimum, on a property
   * whose failure mode is invisible in a PDF. The probe in
   * `scripts/preview-catalog.ts` is what actually watches for the clipping;
   * this only pins the declaration.
   */
  it("floors a row at its own content rather than at an automatic minimum", async () => {
    const rowSizing = (await gridStyle(8, true)).match(/grid-auto-rows:([^;]*)/)?.[1];
    expect(rowSizing).toBe(`minmax(min-content,${MAX_FILLED_ROW_PX}px)`);
  });

  /**
   * A page holding one row has a whole 760px box to grow into, and a 760px
   * card beside a 112px-wide image column is a worse page than the whitespace
   * it replaced. What the cap leaves over goes back to `space-evenly`.
   * `MAX_FILLED_ROW_PX` carries the rendered evidence behind the number.
   */
  it("caps the growth, so a sparse page does not print a card the height of the sheet", async () => {
    for (const count of [2, 6, 8]) {
      expect(await gridStyle(count, true)).toContain(`,${MAX_FILLED_ROW_PX}px)`);
    }
  });
});
