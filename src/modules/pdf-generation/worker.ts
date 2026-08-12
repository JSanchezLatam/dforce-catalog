/**
 * pdf-generation — pg-boss worker (R6.1-8, NFR-3). Playwright is the only
 * PDF-rendering import in this module (design.md's Architecture Decisions:
 * Playwright over Puppeteer — the official Playwright Docker image already
 * bundles Chromium + OS deps, wired in PR1's Dockerfile).
 *
 * Queue-slot release timing (design.md's "PDF Pipeline", step 1 / Risk
 * decision "Queue slot release: free at PDF-generated"): the `pdf-generate`
 * slot frees the instant this worker callback resolves — NOT when the
 * eventual R2 upload (PR8) completes. This worker's LAST action is handing
 * the rendered buffer to a `pdf-upload` job and returning; it never awaits
 * the upload itself.
 *
 * Handoff shape (resolved in PR8): the rendered PDF buffer is NOT put inline
 * in the `pdf-upload` job payload — pg-boss payloads are JSONB, and a
 * multi-MB binary blob embedded there would bloat `pgboss.job` and every
 * query against it. Instead the buffer is written to a local temp file (this
 * is ONE long-lived Docker process per design.md, not serverless, so the
 * file survives from "render complete" to "the pdf-upload worker picks it
 * up" within the same container) and only the file path crosses the job
 * boundary as `pdfBufferRef` — matching design.md's literal payload shape
 * `{ catalogId, userId, pdfBufferRef }` (unchanged by PR8).
 *
 * PR7's "PR8 MUST" gap — `pdf-upload`'s payload has no `title`/`categories`
 * for the `catalogs` row — is resolved here, NOT by widening that payload:
 * `createPendingCatalog()` inserts the row right below, while this worker
 * still has the full `pdf-generate` payload (title, sections) in hand. The
 * `pdf-upload` worker (catalog-storage/upload-status.ts) only ever needs
 * `catalogId`/`userId`/`pdfBufferRef` to know WHICH already-existing row to
 * update.
 *
 * `pdf-upload` is enqueued with pg-boss's native `retryLimit:2`/`retryDelay:
 * 30` (R11.5) — see catalog-storage/upload-status.ts for why that worker
 * does a single attempt per invocation instead of a manual retry loop.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

import { getBoss } from "@/shared/jobs/boss";
import type { CatalogTemplateBranding } from "@/shared/template/CatalogTemplate";
import { getObject } from "../catalog-storage/r2";
import { createPendingCatalog } from "../catalog-storage/queries";
import { buildIndexSections } from "../catalog-builder/selection";
import { PDF_GENERATE_JOB, PDF_UPLOAD_JOB, type PdfBranding, type PdfGeneratePayload } from "./enqueue";
import { PAGE_MARGIN_MM, chunkProducts, renderCatalogHtml } from "./render";

export type PdfUploadPayload = {
  catalogId: string;
  userId: string;
  pdfBufferRef: string;
};

const TEMP_DIR = join(tmpdir(), "dforce-catalog-pdfs");

/** Writes the rendered buffer to a local temp file and returns its path — the `pdfBufferRef` PR8 will read. */
export async function handoffPdfBuffer(catalogId: string, buffer: Buffer): Promise<string> {
  await mkdir(TEMP_DIR, { recursive: true });
  const filePath = join(TEMP_DIR, `${catalogId}.pdf`);
  await writeFile(filePath, buffer);
  return filePath;
}

/**
 * design D3 / explore.md Risk 1 — `templateConfig.logoUrl` used to be
 * Playwright-fetchable; `workshopConfig.logoR2Key` sits behind an
 * authenticated route (`api/workshop-config/logo/route.ts`), which Playwright
 * cannot authenticate against. Reads the R2 object server-side and inlines it
 * as a `data:` URI instead. `getObject()` returning `null` (missing object)
 * yields `logoUrl: null` — a missing logo must not fail a job that already
 * consumed one of `MAX_QUEUE_DEPTH` queue slots; the cover simply renders no
 * `<img>`. Extracted as its own injectable-dep function (this repo's
 * standing `deps?.thing ?? real` seam) so this — the actual crux of this work
 * unit — gets real unit coverage without mocking Playwright's Chromium.
 *
 * WU5 (design D6) reuses the exact same seam for `coverImageR2Key` — one
 * more R2 read before `renderCatalogHtml`, same null-not-throw contract.
 * `contact` needs no R2 read at all (plain text) and travels through as-is.
 */
async function resolveImageDataUri(
  key: string | null | undefined,
  contentType: string | null | undefined,
  fetchObject: typeof getObject,
): Promise<string | null> {
  if (!key) return null;
  const buffer = await fetchObject(key);
  if (!buffer) return null;
  return `data:${contentType ?? "image/png"};base64,${buffer.toString("base64")}`;
}

export async function resolveBranding(
  branding: PdfBranding | null,
  deps: { getObject?: typeof getObject } = {},
): Promise<CatalogTemplateBranding | null> {
  if (!branding) return null;
  const fetchObject = deps.getObject ?? getObject;

  const [logoUrl, coverImageUrl] = await Promise.all([
    resolveImageDataUri(branding.logoR2Key, branding.logoContentType, fetchObject),
    resolveImageDataUri(branding.coverImageR2Key, branding.coverImageContentType, fetchObject),
  ]);

  return {
    templateId: branding.templateId,
    logoUrl,
    coverImageUrl,
    coverText: branding.coverText,
    contact: branding.contact ?? null,
  };
}

/**
 * The printed A4 page, minus `renderCatalogHtml`'s own `@page` margin, in CSS
 * px — Chromium lays print content out at 96dpi, so 1mm is 96/25.4 px.
 * Measuring at any other width would measure the wrong card: the product name
 * wraps differently at 1280px (Playwright's default viewport) than in the
 * ~643px column the paper actually gives it, and a card that wraps less
 * measures shorter than it prints.
 */
const MM_TO_PX = 96 / 25.4;
// `floor`, not `round`: 170mm is 642.52px, and measuring in a column even half
// a pixel WIDER than the printed one wraps the name less, so the card measures
// shorter than it prints. Under-measuring the width over-estimates the height,
// and over-estimating only costs an emptier page.
const PRINT_WIDTH_PX = Math.floor((210 - 2 * PAGE_MARGIN_MM) * MM_TO_PX);
const PRINT_HEIGHT_PX = (297 - 2 * PAGE_MARGIN_MM) * MM_TO_PX;

/**
 * Archive gap #1 — asks the browser how tall each card is instead of
 * estimating it (an estimate is exactly what this replaces). Runs against a
 * document holding every product in ONE grid, so every card exists to be
 * measured; `chunkProducts` then forms the rows and the caller re-renders
 * with the resulting split.
 *
 * The grid's row gap is folded into every card height, so a row works out to
 * `max(card) + gap` without the packer knowing the grid's gap at all. That
 * counts one gap too many per page, which errs towards breaking early —
 * overflowing is the bug, a slightly emptier page is not. `chrome` is the
 * product section's own vertical padding, which eats into the page before
 * any card does.
 *
 * A miss on the selector must not fail a job that already holds one of
 * `MAX_QUEUE_DEPTH` slots (`resolveBranding`'s null-not-throw precedent), but
 * it does degrade the split back to fixed-count chunking — archive gap #1
 * restored. That is worth a line in the log rather than silence.
 */
async function measureCardHeights(page: Page): Promise<{ cardHeights: number[]; chrome: number }> {
  return page.evaluate(() => {
    const grid = document.querySelector('[aria-label^="Product page"] > div');
    if (!(grid instanceof HTMLElement) || !grid.parentElement) return { cardHeights: [], chrome: 0 };

    const section = getComputedStyle(grid.parentElement);
    const chrome = parseFloat(section.paddingTop) + parseFloat(section.paddingBottom);
    const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;

    return {
      cardHeights: Array.from(grid.children, (card) => card.getBoundingClientRect().height + gap),
      chrome,
    };
  });
}

/**
 * R6.1/NFR-3 — Playwright render. Not unit-tested (would require a real
 * Chromium browser process); deferred to integration/E2E coverage, same gap
 * category already flagged for DB/pg-boss integration since PR2/PR3. The
 * logo data-URI resolution it depends on (`resolveBranding`) IS unit-tested
 * (worker.test.ts), and so is the page packing (`chunkProducts`, render.test.ts).
 *
 * Two `setContent` calls in the SAME browser — measure, then split, then
 * render — not two browser launches. The first pass exists only so the split
 * is made against real measured heights rather than a guess.
 */
export async function renderPdfBuffer(
  payload: PdfGeneratePayload,
  deps: { getObject?: typeof getObject } = {},
): Promise<Buffer> {
  const branding = await resolveBranding(payload.branding, deps);
  const props = {
    title: payload.title,
    branding,
    sections: payload.sections.length > 0 ? payload.sections : buildIndexSections(payload.products),
    defaultImageHandling: payload.defaultImageHandling,
  };

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: PRINT_WIDTH_PX, height: Math.round(PRINT_HEIGHT_PX) },
    });
    // `page.pdf()` renders under print media; measure under it too, or a
    // future `@media print` rule would silently invalidate the measurement.
    await page.emulateMedia({ media: "print" });

    const everythingOnOnePage = payload.products.length > 0 ? [payload.products] : [];
    // `domcontentloaded`, not `load`: every product image has a CSS-fixed
    // height (160/180px, image or placeholder alike), so no measured height
    // waits on a byte arriving. Blocking on `load` here would download all
    // 200 images purely to throw the document away — the render pass below
    // fetches them again, and this job holds the single queue slot meanwhile.
    await page.setContent(await renderCatalogHtml({ ...props, productPages: everythingOnOnePage }), {
      waitUntil: "domcontentloaded",
    });
    const { cardHeights, chrome } = await measureCardHeights(page);
    // Warned here, in Node — a `console.warn` inside `page.evaluate` goes to
    // the browser's console, which nothing is listening to.
    if (cardHeights.length < payload.products.length) {
      console.warn(
        `[pdf-generation] measured ${cardHeights.length} of ${payload.products.length} cards for catalog ${payload.catalogId} — unmeasured cards count as 0-tall, so those pages fall back to count-only splitting and may overflow`,
      );
    }

    const productPages = chunkProducts(payload.products, payload.productsPerPage, cardHeights, PRINT_HEIGHT_PX - chrome);
    await page.setContent(await renderCatalogHtml({ ...props, productPages }), { waitUntil: "load" });
    return await page.pdf({ format: "A4", printBackground: true });
  } finally {
    await browser.close();
  }
}

/** Registers the pg-boss worker — `localConcurrency:1` is R12.1's single active slot (same deviation from design.md's literal `teamSize:1` as inventory-sync/job.ts, confirmed via node_modules/pg-boss/dist/types.d.ts). */
export async function registerPdfGenerateWorker(): Promise<void> {
  const boss = await getBoss();
  await boss.createQueue(PDF_GENERATE_JOB);
  await boss.createQueue(PDF_UPLOAD_JOB);

  await boss.work<PdfGeneratePayload>(PDF_GENERATE_JOB, { localConcurrency: 1 }, async ([job]) => {
    const buffer = await renderPdfBuffer(job.data);
    const pdfBufferRef = await handoffPdfBuffer(job.data.catalogId, buffer);
    // Risk-1 (PR8) — insert the catalogs row BEFORE enqueuing pdf-upload, so
    // a crash at any later point still leaves a visible "pending" row.
    await createPendingCatalog(job.data);
    await boss.send(
      PDF_UPLOAD_JOB,
      { catalogId: job.data.catalogId, userId: job.data.userId, pdfBufferRef } satisfies PdfUploadPayload,
      { retryLimit: 2, retryDelay: 30 }, // R11.5 — pg-boss's own native retry (see catalog-storage/upload-status.ts)
    );
    // Returning here resolves the job — pg-boss frees this worker's
    // localConcurrency:1 slot right now, at "PDF generated", regardless of
    // how long the decoupled upload+retention (catalog-storage) takes.
  });
}
