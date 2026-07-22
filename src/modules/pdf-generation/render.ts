/**
 * pdf-generation — pure render-prep helpers (R6.1). Kept Playwright-free and
 * DB-free on purpose: page-chunking and HTML assembly are unit-testable
 * without a browser or a database. `worker.ts` is the only file in this
 * module that imports Playwright.
 */
import { renderToStaticMarkup } from "react-dom/server";

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
 */
export function renderCatalogHtml(props: CatalogTemplateProps): string {
  const body = renderToStaticMarkup(CatalogTemplate(props));
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @page { margin: 20mm; }
      body { font-family: ${props.branding?.font ?? "sans-serif"}, sans-serif; margin: 0; }
      img { max-width: 100%; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}
