/**
 * Visual gate for the mockup translation — NOT a test.
 *
 * Renders the real `CatalogTemplate` against real database rows through the
 * same measure -> chunk -> render sequence the worker uses, then screenshots
 * every printed page. A green unit suite says nothing about whether a page
 * looks right; this is the thing that does.
 *
 * Run: npx tsx scripts/preview-catalog.ts
 *      TIERS=taller npx tsx scripts/preview-catalog.ts   (one price row)
 *
 * `TIERS` is a comma-separated subset of venta,taller,socio — the same choice
 * the review step offers. It matters here more than anywhere else: a one-row
 * card is the new minimum card height, and card height is what drives page
 * packing. Defaults to the renderer's own default when unset.
 * Output: preview-out/ (gitignored) — one PNG per printed page, plus the PDF.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { chromium, type Page } from "playwright";

import { resolveAllPrices } from "@/modules/catalog-builder/price-lists";
import { listCategoryPairs, listProductsInCategories } from "@/modules/catalog-builder/queries";
import {
  buildIndexSections,
  CatalogSelectionValidationError,
  validateCatalogSelection,
} from "@/modules/catalog-builder/selection";
import { chunkProducts, renderCatalogHtml } from "@/modules/pdf-generation/render";
import { buildMeasurementProps, buildPrintProps, measureCardHeights, resolveBranding } from "@/modules/pdf-generation/worker";
import { getTemplateConfig } from "@/modules/template-config/service";
import { buildWorkshopContact } from "@/modules/workshop-config/contact";
import { getWorkshopConfig } from "@/modules/workshop-config/service";
import { getTemplate } from "@/shared/template/registry";
import type { CatalogTemplateProps, ProductPrintRef } from "@/shared/template/CatalogTemplate";
import { CONTENT_HEIGHT_PX, PAGE_HEIGHT_PX, PAGE_WIDTH_PX } from "@/shared/template/page-geometry";
import type { PriceTier } from "@/shared/template/price-tiers";

const OUT = join(process.cwd(), "preview-out");

/**
 * The one check in this file that uses INVENTED products, and the one place
 * that is right.
 *
 * Everything else here previews real rows because faking them hides real
 * failures. This checks the opposite thing: a page whose rows are NOT all the
 * same height. Real catalog names top out around two lines — the tallest card
 * in the dev database is 135px — so no amount of real data reaches a row over
 * the fill cap, and the case only exists if it is built.
 *
 * It shipped once for exactly that reason. `grid-auto-rows: minmax(auto, N)`
 * reads as "never below the natural card"; it is not, because the card sets
 * `height: 100%` and `overflow: hidden`, so Chromium clamped a naturally 217px
 * card to 179px and the price rows went out of a hidden overflow. Silently, in
 * a PDF a customer reads. jsdom cannot see it (no layout engine), the unit
 * tests rendered identical cards, and the preview's real rows never got near
 * the cap. This is the check that does see it.
 *
 * Two properties, both read off a real print-media layout:
 *   - no card is clipped — its content fits the box it was given;
 *   - the filled grid is no taller than the same page's natural grid, so
 *     filling never turns a page the packer accepted into one that overflows.
 */
async function assertFilledRowsAreHonest(page: Page, props: CatalogTemplateProps): Promise<void> {
  const card = (id: string, nameLines: number): ProductPrintRef => ({
    id,
    name: Array.from({ length: nameLines }, (_, at) => `LINEA DE NOMBRE ${at}`).join(" "),
    categoryL1: "AUDIO",
    categoryL2: "BOCINAS",
    prices: { venta: 40, taller: 35, socio: null },
  });

  // One tall row and three short ones, then a card taller than the whole sheet
  // (the spec's "a product taller than a page" scenario, which must still be
  // placed alone and run visibly off the bottom rather than be trimmed to fit).
  const mixed = [card("T1", 14), card("S1", 1), card("S2", 1), card("S3", 1), card("S4", 1), card("S5", 1), card("S6", 1), card("S7", 1)];
  const cases: [string, ProductPrintRef[]][] = [
    ["mixed row heights", mixed],
    ["one very tall row", [card("T1", 40), card("S1", 1), card("S2", 1), card("S3", 1)]],
    ["a card taller than the sheet", [card("G1", 90)]],
  ];

  const read = async () =>
    page.evaluate(() => {
      const grid = document.querySelector("[data-product-grid]");
      if (!(grid instanceof HTMLElement)) return null;
      return {
        height: Math.round(grid.getBoundingClientRect().height),
        // `getBoundingClientRect` on the grid reports the BOX; the rows can
        // still be taller than it, so read the content too.
        content: grid.scrollHeight,
        clipped: Array.from(grid.children).filter((wrapper) => {
          const box = wrapper.firstElementChild as HTMLElement;
          return box.scrollHeight > box.clientHeight + 1;
        }).length,
      };
    });

  let failed = false;
  for (const [name, products] of cases) {
    await page.setContent(await renderCatalogHtml(buildMeasurementProps(props, products)), { waitUntil: "domcontentloaded" });
    const natural = await read();
    await page.setContent(await renderCatalogHtml(buildPrintProps(props, [products])), { waitUntil: "domcontentloaded" });
    const filled = await read();

    const naturalContent = natural?.content ?? 0;
    const grew = (filled?.content ?? 0) > Math.max(naturalContent, CONTENT_HEIGHT_PX);
    const clipped = (filled?.clipped ?? 0) > 0;
    console.log(
      `  ${name.padEnd(30)} natural ${naturalContent}px -> filled ${filled?.content}px` +
        `${clipped ? `, ${filled?.clipped} CARD(S) CLIPPED` : ""}`,
    );
    if (clipped || grew) failed = true;

    // Screenshotted as well as measured. "No card is clipped" is a number a
    // human can read past; a tall row sitting beside short ones is a thing they
    // can only judge by looking, and these are the only sheets in `preview-out/`
    // that have one.
    const sheet = await page.$('[data-sheet^="product-"]');
    await sheet?.screenshot({ path: join(OUT, `probe-${name.replaceAll(" ", "-")}.png`) });
  }

  if (failed) {
    console.error(
      "FAIL: filling a page either clipped a card or grew a grid past what its natural rows needed — " +
        "a product is being trimmed or a page overflowed. See CatalogTemplate's product grid.",
    );
    process.exit(1);
  }
}

async function main() {
  const requestedTiers = process.env.TIERS?.split(",")
    .map((tier) => tier.trim())
    .filter(Boolean);
  const tiers = requestedTiers as PriceTier[] | undefined;
  try {
    // The SAME validator the route runs, not a hand-rolled subset of it: an
    // unknown name, a repeat, or all three at once must fail here too. A
    // three-row card is taller than anything the shipped UI or route can
    // produce, and card height is the one thing this script exists to look at
    // — previewing an impossible card is the wrong answer that matters here.
    validateCatalogSelection({ includedCategoryCount: 1, totalProductCount: 1, productsPerPage: 6, tiers });
  } catch (err) {
    if (err instanceof CatalogSelectionValidationError) {
      console.error(`TIERS: ${err.errors.tiers ?? "selección inválida"}`);
      process.exit(1);
    }
    throw err;
  }

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

  // Passed through undefined when TIERS is unset, so the preview exercises
  // `CatalogTemplate`'s real default rather than a second copy of it.
  const props = {
    title: "Catálogo de productos",
    branding,
    sections: buildIndexSections(products),
    tiers,
    defaultImageHandling: (template?.defaultImageHandling ?? null) as "strict" | "adaptive" | null,
  };

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX } });
  await page.emulateMedia({ media: "print" });

  // Same two-pass sequence as worker.ts: measure every card in one grid, then
  // split against the real content height, then render the split. The props
  // for both passes are built by the worker's OWN builders rather than by hand
  // — same reason the query and `measureCardHeights` are imported. Assembling
  // them here is how the gate drifts from the thing it is gating: the two
  // passes differ by one prop (`fillPageHeight`), and a copy that sets it on
  // the wrong one previews a layout nobody generates.
  await page.setContent(await renderCatalogHtml(buildMeasurementProps(props, products)), {
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

  // Wiped, not just created. This gate's exit criterion is a human looking at
  // the PNGs, so a stale sheet left over from an earlier run is not clutter —
  // it is a wrong answer wearing a plausible filename. Two ways it bit:
  // a renamed sheet leaves its old file behind forever (`02-Product-page-1.png`
  // outlived the switch to `data-sheet`), and on a case-insensitive filesystem
  // writing `00-cover.png` over an existing `00-Cover.png` replaces the bytes
  // but KEEPS the old name, so the directory disagrees with this script's own
  // log about what it just wrote.
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // Before the PNGs, the case the PNGs cannot contain. Runs in this same
  // print-media browser, and hard-fails: a clipped product is not something a
  // human should have to spot in a screenshot.
  console.log("\nfilled rows, on pages real data cannot produce:");
  await assertFilledRowsAreHonest(page, props);

  const html = await renderCatalogHtml(buildPrintProps(props, productPages));
  await page.setContent(html, { waitUntil: "load" });

  const sheets = await page.$$("article > section");
  for (const [index, sheet] of sheets.entries()) {
    // `data-sheet`, not `aria-label`: the label is Spanish prose meant for a
    // reader, so it carries accents and would change with the copy. The data
    // attribute is the sheet's stable ASCII machine name, which is what a
    // filename wants.
    const name = (await sheet.getAttribute("data-sheet")) ?? `sheet-${index}`;
    const box = await sheet.boundingBox();
    // A sheet that is not exactly PAGE_WIDTH x PAGE_HEIGHT will not print as
    // one page, so the size is worth reading even before looking at the PNG.
    console.log(`  ${name}: ${box?.width}x${box?.height}`);
    await sheet.screenshot({ path: join(OUT, `${String(index).padStart(2, "0")}-${name}.png`) });
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
  const expectedHeight = sheets.length * PAGE_HEIGHT_PX;
  console.log(`\n${sheets.length} sheets, document ${documentHeight}px (expected ${expectedHeight}px)`);

  await writeFile(join(OUT, "catalog.pdf"), await page.pdf({ format: "Letter", printBackground: true }));
  await browser.close();

  // One pixel of tolerance per sheet: `scrollHeight` is a rounded integer, so
  // sub-pixel layout accumulates. Exact equality here would contradict the
  // paragraph above it — a gate that goes red on a document that prints fine
  // is the false failure this check was rewritten to avoid.
  if (Math.abs(documentHeight - expectedHeight) > sheets.length) {
    console.error(
      `FAIL: ${sheets.length} sheets should stack to ${expectedHeight}px, got ${documentHeight}px — ` +
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
