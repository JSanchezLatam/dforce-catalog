/**
 * pdf-generation — pure render-prep helpers (R6.1). Kept Playwright-free and
 * DB-free on purpose: page-chunking and HTML assembly are unit-testable
 * without a browser or a database. `worker.ts` is the only file in this
 * module that imports Playwright.
 */
import { CatalogTemplate, type CatalogTemplateProps, type ProductPrintRef } from "@/shared/template/CatalogTemplate";

/** R6.1/R5.4 — splits the final (post-exclusion) product set into fixed-size printed pages. */
export function chunkProducts(products: ProductPrintRef[], productsPerPage: number): ProductPrintRef[][] {
  if (!Number.isInteger(productsPerPage) || productsPerPage <= 0) {
    return products.length > 0 ? [products] : [];
  }
  const pages: ProductPrintRef[][] = [];
  for (let i = 0; i < products.length; i += productsPerPage) {
    pages.push(products.slice(i, i + productsPerPage));
  }
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
      @page { margin: 20mm; }
      body { font-family: ${props.branding?.font ?? "sans-serif"}, sans-serif; margin: 0; }
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
