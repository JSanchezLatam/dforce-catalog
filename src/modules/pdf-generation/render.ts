/**
 * pdf-generation — pure render-prep helpers (R6.1). Kept Playwright-free and
 * DB-free on purpose: page-chunking and HTML assembly are unit-testable
 * without a browser or a database. `worker.ts` is the only file in this
 * module that imports Playwright.
 */
import { CatalogTemplate, GRID_COLUMNS, type CatalogTemplateProps, type ProductPrintRef } from "@/shared/template/CatalogTemplate";
import { getTemplate } from "@/shared/template/registry";

/**
 * R6.1/R5.4 — splits the final (post-exclusion) product set into printed pages.
 *
 * `maxProductsPerPage` is a MAXIMUM, not an exact count. Splitting by count
 * alone promised a page layout the paper could not deliver: WU4's three-row
 * price table (Venta/Taller/Socio) made cards tall enough that a 10-product
 * chunk spilled across two physical pages (archive gap #1 of
 * `2026-08-12-catalog-templates-and-workshop-info`). Chromium was already
 * paginating by height correctly — the fixed-count split was fighting it.
 *
 * So both constraints hold: the user says "no more than N per page", the
 * browser says "and never more than what fits". `cardHeights` is what the
 * browser measured (`worker.ts`, which owns the only Playwright import in
 * this module), each already carrying the grid's row gap so this function
 * never needs to know it. Pure on purpose, so the packing is unit-testable
 * without a browser; with no measurement passed every card counts as 0-tall
 * and only the count binds.
 *
 * Heights arrive per CARD but bind per ROW, and the rows are formed HERE
 * rather than by the measuring pass: an odd `maxProductsPerPage` puts the
 * next page's first card in a different column than the single-grid
 * measurement saw, so pre-paired row heights would be measuring one layout
 * and paginating another — and would quietly round an explicit 3 per page
 * down to 2.
 */
export function chunkProducts(
  products: ProductPrintRef[],
  maxProductsPerPage: number,
  cardHeights: number[] = [],
  usableHeight: number = Infinity,
): ProductPrintRef[][] {
  const maxPerPage =
    Number.isInteger(maxProductsPerPage) && maxProductsPerPage > 0 ? maxProductsPerPage : Infinity;

  const pages: ProductPrintRef[][] = [];
  let page: ProductPrintRef[] = [];
  let closedRows = 0; // the rows already complete on this page
  let openRow = 0; // the row still being filled, as tall as its tallest card so far

  for (const [index, product] of products.entries()) {
    const card = cardHeights[index] ?? 0;
    // The card either opens the next row or joins the open one, where the
    // taller of the two decides how much vertical space that row takes.
    const opensRow = page.length % GRID_COLUMNS === 0;
    const closed = opensRow ? closedRows + openRow : closedRows;
    const open = opensRow ? card : Math.max(openRow, card);

    // `page.length > 0` is what stops a card taller than a whole page from
    // looping forever: on an empty page it is taken regardless of fit, and
    // Chromium handles the unavoidable overflow itself.
    if (page.length > 0 && (page.length + 1 > maxPerPage || closed + open > usableHeight)) {
      pages.push(page);
      page = [product];
      closedRows = 0;
      openRow = card;
      continue;
    }
    page.push(product);
    closedRows = closed;
    openRow = open;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

/**
 * R6.1 — renders the SAME `CatalogTemplate` component the builder's live
 * preview uses (Risk-5, design.md "New Risks Flagged" #5) to a full HTML
 * document string, ready for Playwright's `page.setContent()`.
 * `renderToStaticMarkup` (not `renderToString`) because this markup is
 * never hydrated client-side — it only ever exists for one `page.pdf()` call.
 *
 * PR9 — `react-dom/server` is imported dynamically (inside the function),
 * not as a static top-level import, so this stays async. A static top-level
 * import here broke `next build` (confirmed with both Turbopack and
 * webpack) once `instrumentation.ts` (PR9) made this module reachable from
 * the app's build graph for the first time — "You're importing a component
 * that imports react-dom/server... render or return the content directly as
 * a Server Component instead." The dynamic import resolves the exact same
 * module at runtime (`react-dom/server` is already a transitive dependency
 * of `react-dom`, a hard dependency here — no new package), it just avoids
 * whatever static-analysis rule that build check applies to top-level
 * imports of it.
 */
export async function renderCatalogHtml(props: CatalogTemplateProps): Promise<string> {
  // The `.card-*` rules this stylesheet used to carry were dead — `AdaptiveCards`
  // styles every card inline and no markup has referenced those classes since.
  // One of them was a second `repeat(2, 1fr)` grid definition: exactly the kind
  // of quiet duplicate the packing above must not end up measuring against.
  const { renderToStaticMarkup } = await import("react-dom/server");
  const body = renderToStaticMarkup(CatalogTemplate(props));
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      /* Full-bleed Letter, matching Portada_DForce_v1.html's own @page rule.
         The margin MUST stay 0: the red header band and black footer band run
         edge to edge on every approved page, and any page margin insets them
         behind a white frame the design never had. The inset the content needs
         is applied inside the sheet instead (see shared/template/page-geometry). */
      @page { size: 8.5in 11in; margin: 0; }
      * { box-sizing: border-box; }
      /* The registry font already carries its own fallback ("Arial, sans-serif"),
         so appending another one produced "..., sans-serif, sans-serif". */
      body { font-family: ${props.branding ? getTemplate(props.branding.templateId).font : "sans-serif"}; margin: 0; -webkit-font-smoothing: antialiased; }
      /* Deliberately NO global \`img { max-width: 100% }\`. The cover photo is
         902px wide on an 816px sheet and hangs off the right edge by design
         (\`right: -118px\` in the approved file); clamping it to the sheet
         squeezes the car back into frame and breaks the composition. Every
         other image already carries its own explicit width or max-width. */
    </style>
  </head>
  <body>${body}</body>
</html>`;
}
