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
 * Handoff shape for PR8: the rendered PDF buffer is NOT put inline in the
 * `pdf-upload` job payload — pg-boss payloads are JSONB, and a multi-MB
 * binary blob embedded there would bloat `pgboss.job` and every query
 * against it. Instead the buffer is written to a local temp file (this is
 * ONE long-lived Docker process per design.md, not serverless, so the file
 * survives from "render complete" to "PR8's pdf-upload worker picks it up"
 * within the same container) and only the file path crosses the job
 * boundary as `pdfBufferRef` — matching design.md's literal payload shape
 * `{ catalogId, userId, pdfBufferRef }`.
 *
 * PR8 MUST: read the file at `pdfBufferRef`, upload it to R2, then delete
 * the temp file (on success or final failure) — this module does not clean
 * up after itself once a job is handed off.
 *
 * ponytail: PR8 doesn't exist yet to register a `pdf-upload` worker, so
 * `pdf-upload` jobs will sit in `created` state until PR8 adds
 * `registerPdfUploadWorker()`. That is expected and matches design.md's
 * decoupled-upload boundary — this worker must not block on that queue
 * having a consumer.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

import { getBoss } from "@/shared/jobs/boss";
import { buildIndexSections } from "../catalog-builder/selection";
import { PDF_GENERATE_JOB, PDF_UPLOAD_JOB, type PdfGeneratePayload } from "./enqueue";
import { chunkProducts, renderCatalogHtml } from "./render";

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
 * R6.1/NFR-3 — Playwright render. Not unit-tested in this PR (would require
 * a real Chromium browser process); deferred to integration/E2E coverage,
 * same gap category already flagged for DB/pg-boss integration since PR2/PR3.
 */
export async function renderPdfBuffer(payload: PdfGeneratePayload): Promise<Buffer> {
  const productPages = chunkProducts(payload.products, payload.productsPerPage);
  const html = renderCatalogHtml({
    title: payload.title,
    branding: payload.branding,
    sections: payload.sections.length > 0 ? payload.sections : buildIndexSections(payload.products),
    productPages,
  });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
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
    await boss.send(PDF_UPLOAD_JOB, {
      catalogId: job.data.catalogId,
      userId: job.data.userId,
      pdfBufferRef,
    } satisfies PdfUploadPayload);
    // Returning here resolves the job — pg-boss frees this worker's
    // localConcurrency:1 slot right now, at "PDF generated", regardless of
    // whether/when a pdf-upload consumer (PR8) exists yet.
  });
}
