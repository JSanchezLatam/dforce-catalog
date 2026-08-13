/**
 * Visual gate for the mockup translation — NOT a test.
 *
 * Renders the real `CatalogTemplate` against real database rows through the
 * same measure -> chunk -> render sequence the worker uses, then screenshots
 * every printed page. A green unit suite says nothing about whether a page
 * looks right; this is the thing that does.
 *
 * Run: npx tsx scripts/preview-catalog.ts
 * Output: preview-out/ (gitignored) — one PNG per printed page, plus the PDF.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { chromium } from "playwright";

import { resolveAllPrices } from "@/modules/catalog-builder/price-lists";
import { listCategoryPairs, listProductsInCategories } from "@/modules/catalog-builder/queries";
import { buildIndexSections } from "@/modules/catalog-builder/selection";
import { chunkProducts, renderCatalogHtml } from "@/modules/pdf-generation/render";
import { measureCardHeights, resolveBranding } from "@/modules/pdf-generation/worker";
import { getTemplateConfig } from "@/modules/template-config/service";
import { buildWorkshopContact } from "@/modules/workshop-config/contact";
import { getWorkshopConfig } from "@/modules/workshop-config/service";
import { getTemplate } from "@/shared/template/registry";
import type { ProductPrintRef } from "@/shared/template/CatalogTemplate";
import { CONTENT_HEIGHT_PX, PAGE_HEIGHT_PX, PAGE_WIDTH_PX } from "@/shared/template/page-geometry";

const OUT = join(process.cwd(), "preview-out");

async function main() {
  // The SAME query the generate step runs — deliberately not a hand-written
  // copy of its SQL. A copy is exactly how this script first "found" that
  // every price was an em-dash: the real query reads Interfuerza's `Precio`
  // key and the copy read `Price`, so the preview was lying about production.
  const categories = await listCategoryPairs();
  const rows = await listProductsInCategories(categories.slice(0, 6));

  const products: ProductPrintRef[] = rows.slice(0, 14).map((row) => ({
    id: row.id,
    name: row.name,
    categoryL1: row.categoryL1,
    categoryL2: row.categoryL2,
    image: row.image,
    imageType: row.imageType,
    prices: resolveAllPrices(row.priceLists),
  }));

  const priced = products.filter((p) => p.prices && (p.prices.venta ?? 0) > 0).length;
  console.log(`${products.length} products (${priced} with a retail price), categories: ${[...new Set(products.map((p) => p.categoryL1))].join(", ")}`);

  // The branding is assembled exactly as `api/catalog-builder/generate` does
  // it, then resolved exactly as the worker does — real `workshop_config` row,
  // real R2 objects inlined as data URIs. This script used to hardcode invented
  // contact details and read the logo off disk, which made it a preview of
  // something nobody generates: a catalog is mostly workshop-owned content, so
  // faking that half hides half the failures.
  const [template, workshop] = await Promise.all([getTemplateConfig(), getWorkshopConfig()]);
  const branding = await resolveBranding({
    templateId: getTemplate(template?.selectedTemplateId).id,
    logoR2Key: workshop?.logoR2Key ?? null,
    logoContentType: workshop?.logoContentType ?? null,
    coverText: workshop?.coverText ?? null,
    coverImageR2Key: workshop?.coverImageR2Key ?? null,
    coverImageContentType: workshop?.coverImageContentType ?? null,
    contact: buildWorkshopContact(workshop ?? null),
  });

  // `resolveBranding` returns null for an R2 object it cannot read rather than
  // failing the job. That is right in production and misleading here — a blank
  // cover in the PNGs would look like a layout bug.
  console.log(
    `workshop: ${workshop?.name ?? "(sin nombre)"} · logo ${branding?.logoUrl ? "ok" : "NO RESUELTO"} · portada ${branding?.coverImageUrl ? "ok" : "NO RESUELTA"}`,
  );

  const props = {
    title: "Catálogo de productos",
    branding,
    sections: buildIndexSections(products),
    defaultImageHandling: (template?.defaultImageHandling ?? null) as "strict" | "adaptive" | null,
  };

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX } });
  await page.emulateMedia({ media: "print" });

  // Same two-pass sequence as worker.ts: measure every card in one grid, then
  // split against the real content height, then render the split.
  await page.setContent(await renderCatalogHtml({ ...props, productPages: [products] }), {
    waitUntil: "domcontentloaded",
  });
  // The worker's own measurement, imported — same reason the query above is
  // imported. A copy of it here would drift from the thing this gate exists
  // to check the moment the grid selector or the gap handling changes.
  const cardHeights = await measureCardHeights(page);
  // `Math.max()` of nothing is -Infinity — the selector-miss path is exactly
  // when this line matters, so it must not print nonsense on it.
  const tallest = cardHeights.length > 0 ? `${Math.max(...cardHeights).toFixed(0)}px` : "none measured";
  console.log(`measured ${cardHeights.length} cards, tallest ${tallest}, page holds ${CONTENT_HEIGHT_PX}px`);

  const productPages = chunkProducts(products, 6, cardHeights, CONTENT_HEIGHT_PX);
  console.log(`split into ${productPages.length} product pages: ${productPages.map((p) => p.length).join(" + ")}`);

  const html = await renderCatalogHtml({ ...props, productPages });
  await page.setContent(html, { waitUntil: "load" });

  await mkdir(OUT, { recursive: true });
  const sheets = await page.$$("article > section");
  for (const [index, sheet] of sheets.entries()) {
    const label = (await sheet.getAttribute("aria-label")) ?? `sheet-${index}`;
    const box = await sheet.boundingBox();
    // A sheet that is not exactly PAGE_WIDTH x PAGE_HEIGHT will not print as
    // one page, so the size is worth reading even before looking at the PNG.
    console.log(`  ${label}: ${box?.width}x${box?.height}`);
    await sheet.screenshot({ path: join(OUT, `${String(index).padStart(2, "0")}-${label.replace(/\s+/g, "-")}.png`) });
  }

  /**
   * Checks that the sheets TILE the paper — the property that decides the page
   * count — rather than counting pages in the PDF bytes.
   *
   * Counting `/Type /Page` in the output looks like the stronger check and is
   * the weaker one: Chromium writes compressed object streams, so page objects
   * are routinely absent from the file as literal ASCII. That check reports
   * zero pages for a perfectly good PDF, and a gate that can fail falsely is
   * worse than no gate — it teaches everyone to ignore it. Parsing it properly
   * means a new dependency for a dev script.
   *
   * The document's own height cannot lie the same way: with `@page` margin 0
   * and each sheet exactly one page tall, total height / page height IS the
   * page count. A stray margin between sheets, or a sheet that grew past its
   * box, shows up here as a fractional or oversized total.
   */
  const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const impliedPages = documentHeight / PAGE_HEIGHT_PX;
  console.log(`\n${sheets.length} sheets, document ${documentHeight}px = ${impliedPages} pages`);

  await writeFile(join(OUT, "catalog.pdf"), await page.pdf({ format: "Letter", printBackground: true }));
  await browser.close();

  if (impliedPages !== sheets.length) {
    console.error(
      `FAIL: ${sheets.length} sheets should stack to ${sheets.length * PAGE_HEIGHT_PX}px, got ${documentHeight}px — ` +
        `a sheet overflowed its box or something adds space between them.`,
    );
    process.exit(1);
  }
  console.log("-> preview-out/");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
