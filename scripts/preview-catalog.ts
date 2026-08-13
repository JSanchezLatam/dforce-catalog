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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { chromium } from "playwright";

import { resolveAllPrices } from "@/modules/catalog-builder/price-lists";
import { listCategoryPairs, listProductsInCategories } from "@/modules/catalog-builder/queries";
import { buildIndexSections } from "@/modules/catalog-builder/selection";
import { chunkProducts, renderCatalogHtml } from "@/modules/pdf-generation/render";
import type { ProductPrintRef } from "@/shared/template/CatalogTemplate";
import { CONTENT_HEIGHT_PX, PAGE_HEIGHT_PX, PAGE_WIDTH_PX } from "@/shared/template/page-geometry";

/** The approved assets live beside the repo, not in it (they are the owner's
 * source files). `workshop_config` is where they belong once loaded. */
const INSUMOS = join(process.cwd(), "..", "Insumos", "Templates");
const OUT = join(process.cwd(), "preview-out");

async function dataUri(file: string, mime: string): Promise<string> {
  return `data:${mime};base64,${(await readFile(join(INSUMOS, file))).toString("base64")}`;
}

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

  // workshop_config is still empty in this database (retrospectiva, pending 2),
  // so the approved assets are fed in directly — the point here is to judge the
  // LAYOUT, and an empty workshop hides half of it.
  const props = {
    title: "Catálogo de productos",
    branding: {
      templateId: "dforce-classic",
      logoUrl: await dataUri("DFORCE CAR AUDIO.png", "image/png"),
      coverText: "Precios vigentes al momento de la generación",
      coverImageUrl: await dataUri("Auto_portada.jpg", "image/jpeg"),
      contact: {
        name: "DForce Car Audio",
        phone: "+507 6000-0000",
        whatsapp: "+507 6000-0000",
        email: "ventas@dforce.com",
        address: "Vía España, Ciudad de Panamá",
        hours: "Lun a Sáb · 8:00 - 18:00",
        website: "dforcecaraudio.com",
        socialHandles: { Instagram: "@dforcecaraudio", Facebook: "DForce Car Audio" },
      },
    },
    sections: buildIndexSections(products),
    defaultImageHandling: "adaptive" as const,
  };

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX } });
  await page.emulateMedia({ media: "print" });

  // Same two-pass sequence as worker.ts: measure every card in one grid, then
  // split against the real content height, then render the split.
  await page.setContent(await renderCatalogHtml({ ...props, productPages: [products] }), {
    waitUntil: "domcontentloaded",
  });
  const cardHeights = await page.evaluate(() => {
    const grid = document.querySelector("[data-product-grid]");
    if (!(grid instanceof HTMLElement)) return [];
    const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
    return Array.from(grid.children, (card) => card.getBoundingClientRect().height + gap);
  });
  console.log(`measured ${cardHeights.length} cards, tallest ${Math.max(...cardHeights).toFixed(0)}px, page holds ${CONTENT_HEIGHT_PX}px`);

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

  await writeFile(join(OUT, "catalog.pdf"), await page.pdf({ format: "Letter", printBackground: true }));
  await browser.close();
  console.log(`\n${sheets.length} sheets -> preview-out/`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
