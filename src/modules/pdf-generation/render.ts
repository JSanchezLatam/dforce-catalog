/**
 * pdf-generation — pure render-prep helpers (R6.1). Kept Playwright-free and
 * DB-free on purpose: page-chunking and HTML assembly are unit-testable
 * without a browser or a database. `worker.ts` is the only file in this
 * module that imports Playwright.
 */
import { CatalogTemplate, type CatalogTemplateProps, type ProductPrintRef } from "@/shared/template/CatalogTemplate";
import { getTemplate } from "@/shared/template/registry";

/** The `@page` margin below, in mm — `worker.ts` subtracts it from A4 to get the height one printed page can actually hold. Keep the two in sync by importing, never by retyping the number. */
export const PAGE_MARGIN_MM = 20;

/** `CatalogTemplate`'s product grid is `repeat(2, 1fr)`: the unit that occupies vertical space is a ROW of two cards, and a row is as tall as its taller card. */
export const GRID_COLUMNS = 2;

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
 * browser says "and never more than what fits". `rowHeights` is what the
 * browser measured (`worker.ts`, which owns the only Playwright import in
 * this module); this function stays pure so the packing is unit-testable
 * without one. Callers with no browser — the builder's live preview — pass
 * no measurement, every row then counts as 0-tall, and only the count binds.
 */
export function chunkProducts(
  products: ProductPrintRef[],
  maxProductsPerPage: number,
  rowHeights: number[] = [],
  usableHeight: number = Infinity,
): ProductPrintRef[][] {
  const maxPerPage =
    Number.isInteger(maxProductsPerPage) && maxProductsPerPage > 0 ? maxProductsPerPage : Infinity;
  // Only `maxPerPage === 1` narrows the row: one card per page cannot share a
  // row with anything, so the measured two-card heights cannot bind anyway.
  const columns = Math.min(GRID_COLUMNS, maxPerPage);

  const pages: ProductPrintRef[][] = [];
  let page: ProductPrintRef[] = [];
  let pageHeight = 0;

  for (let row = 0; row * columns < products.length; row += 1) {
    const cards = products.slice(row * columns, (row + 1) * columns);
    const height = rowHeights[row] ?? 0;
    const fits = page.length + cards.length <= maxPerPage && pageHeight + height <= usableHeight;
    // `page.length > 0` is what stops a row taller than a whole page from
    // looping forever: on an empty page the row is taken regardless of fit,
    // and Chromium handles the unavoidable overflow itself.
    if (page.length > 0 && !fits) {
      pages.push(page);
      page = [];
      pageHeight = 0;
    }
    page.push(...cards);
    pageHeight += height;
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
  const { renderToStaticMarkup } = await import("react-dom/server");
  const body = renderToStaticMarkup(CatalogTemplate(props));
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @page { margin: ${PAGE_MARGIN_MM}mm; }
      /* The registry font already carries its own fallback ("Arial, sans-serif"),
         so appending another one produced "..., sans-serif, sans-serif". */
      body { font-family: ${props.branding ? getTemplate(props.branding.templateId).font : "sans-serif"}; margin: 0; }
      img { max-width: 100%; }
      .card-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
      .card-fullbleed { break-inside: avoid; display: flex; flex-direction: column; }
      .card-fullbleed img { width: 100%; height: 180px; object-fit: cover; }
      .card-polaroid { break-inside: avoid; display: flex; flex-direction: column; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
      .card-polaroid img { width: 100%; height: 160px; object-fit: contain; }
      .card-placeholder { width: 100%; height: 180px; background: #f3f4f6; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 14px; }
      .card-label { padding: 0.5rem 0; }
      .card-label p { margin: 0; }
      .card-name { font-weight: 600; font-size: 13px; }
      .card-cat { font-size: 11px; color: #6b7280; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}
