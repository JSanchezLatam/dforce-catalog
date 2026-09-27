/**
 * Design D3 / Risk 1 (explore.md) — Playwright cannot authenticate against
 * the workshop logo's session-gated route, so `renderPdfBuffer` must read the
 * R2 object server-side and inline it as a `data:` URI before handing HTML to
 * Playwright. `renderPdfBuffer` itself launches a real Chromium browser and
 * has no unit coverage by design (design.md's Testing Strategy table) — the
 * resolution logic is extracted into `resolveBranding` so THAT part, the
 * actual crux of this work unit, gets real (injected-dependency) unit
 * coverage instead of being untestable-by-association with Playwright.
 */
import type { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import { PDF_GENERATE_JOB, type PdfBranding } from "./enqueue";
import { resolveBranding, buildMeasurementProps, buildPrintProps, buildTemplateProps, registerPdfGenerateWorker } from "./worker";

// WU4 (design.md decision 18) — capture.ts's withJobCapture defaults its
// `report` param to Sentry.captureException; mocking it here lets the
// registerPdfGenerateWorker test below assert on the real wiring without a
// live Sentry transport. vi.hoisted is required because "./worker" above is
// a STATIC import that resolves "@sentry/nextjs" via capture.ts before any
// later bare top-level const would run (see reminders/job.test.ts's fuller
// comment on this exact TDZ trap).
const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

describe("resolveBranding — D3 logo data-URI resolution", () => {
  it("returns null branding unchanged", async () => {
    expect(await resolveBranding(null)).toBeNull();
  });

  it("resolves logoR2Key via getObject() into a data: URI", async () => {
    const branding: PdfBranding = {
      templateId: "dforce-classic",
      logoR2Key: "logos/1.png",
      logoContentType: "image/png",
      coverText: "Bienvenido",
    };
    const getObject = vi.fn().mockResolvedValue(Buffer.from("fake-bytes"));

    const result = await resolveBranding(branding, { getObject });

    expect(getObject).toHaveBeenCalledWith("logos/1.png");
    expect(result).toEqual({
      templateId: "dforce-classic",
      logoUrl: `data:image/png;base64,${Buffer.from("fake-bytes").toString("base64")}`,
      coverImageUrl: null,
      coverText: "Bienvenido",
      contact: null,
    });
  });

  it("defaults the content type to image/png when logoContentType is null", async () => {
    const branding: PdfBranding = { templateId: "dforce-classic", logoR2Key: "logos/1", logoContentType: null, coverText: null };
    const getObject = vi.fn().mockResolvedValue(Buffer.from("x"));

    const result = await resolveBranding(branding, { getObject });

    expect(result?.logoUrl).toMatch(/^data:image\/png;base64,/);
  });

  // getObject() returning null (object missing/deleted) must not fail a job
  // that already consumed one of three queue slots (design D3) — the cover
  // simply renders no <img>.
  it("yields logoUrl: null when getObject() returns null, without throwing", async () => {
    const branding: PdfBranding = { templateId: "dforce-classic", logoR2Key: "logos/gone.png", logoContentType: "image/png", coverText: null };
    const getObject = vi.fn().mockResolvedValue(null);

    const result = await resolveBranding(branding, { getObject });

    expect(result).toEqual({ templateId: "dforce-classic", logoUrl: null, coverImageUrl: null, coverText: null, contact: null });
  });

  it("yields logoUrl: null without calling getObject() when there is no logoR2Key", async () => {
    const branding: PdfBranding = { templateId: "dforce-classic", logoR2Key: null, logoContentType: null, coverText: "Hola" };
    const getObject = vi.fn();

    const result = await resolveBranding(branding, { getObject });

    expect(getObject).not.toHaveBeenCalled();
    expect(result).toEqual({ templateId: "dforce-classic", logoUrl: null, coverImageUrl: null, coverText: "Hola", contact: null });
  });
});

/**
 * WU5 (design D6) — the cover image resolves through the exact same
 * server-side `getObject` path as the logo (D3, reused). `contact` is plain
 * text and travels through `resolveBranding` verbatim, with no R2 read.
 */
describe("resolveBranding — D6 cover-image data-URI resolution", () => {
  const contact = { name: "Taller", phone: "555-1234", whatsapp: null, email: null, address: null, hours: null, website: null, socialHandles: null };

  it("resolves coverImageR2Key via getObject() into a data: URI, same as the logo", async () => {
    const branding: PdfBranding = {
      templateId: "dforce-classic",
      logoR2Key: null,
      logoContentType: null,
      coverText: null,
      coverImageR2Key: "covers/1.jpg",
      coverImageContentType: "image/jpeg",
    };
    const getObject = vi.fn().mockResolvedValue(Buffer.from("cover-bytes"));

    const result = await resolveBranding(branding, { getObject });

    expect(getObject).toHaveBeenCalledWith("covers/1.jpg");
    expect(result?.coverImageUrl).toBe(`data:image/jpeg;base64,${Buffer.from("cover-bytes").toString("base64")}`);
  });

  // A missing cover photo must not fail a job that already consumed a queue
  // slot — the cover degrades to the template's red/black block.
  it("yields coverImageUrl: null when coverImageR2Key is absent, without calling getObject() for it", async () => {
    const branding: PdfBranding = { templateId: "dforce-classic", logoR2Key: null, logoContentType: null, coverText: null };
    const getObject = vi.fn();

    const result = await resolveBranding(branding, { getObject });

    expect(getObject).not.toHaveBeenCalled();
    expect(result?.coverImageUrl).toBeNull();
  });

  it("yields coverImageUrl: null when getObject() returns null, without throwing", async () => {
    const branding: PdfBranding = {
      templateId: "dforce-classic",
      logoR2Key: null,
      logoContentType: null,
      coverText: null,
      coverImageR2Key: "covers/gone.jpg",
      coverImageContentType: "image/jpeg",
    };
    const getObject = vi.fn().mockResolvedValue(null);

    const result = await resolveBranding(branding, { getObject });

    expect(result?.coverImageUrl).toBeNull();
  });

  it("passes contact through verbatim, with no R2 read for it", async () => {
    const branding: PdfBranding = { templateId: "dforce-classic", logoR2Key: null, logoContentType: null, coverText: null, contact };
    const getObject = vi.fn();

    const result = await resolveBranding(branding, { getObject });

    expect(result?.contact).toEqual(contact);
  });

  it("passes a null contact through as null", async () => {
    const branding: PdfBranding = { templateId: "dforce-classic", logoR2Key: null, logoContentType: null, coverText: null, contact: null };

    const result = await resolveBranding(branding, { getObject: vi.fn() });

    expect(result?.contact).toBeNull();
  });
});

/**
 * The measurement pass and the print pass share one props object, and only
 * the print pass is observable in a rendered PDF. A field that reaches the
 * template but not the measurement would paginate against card heights that
 * never get printed — so what is asserted here is that the payload's
 * layout-affecting fields survive the hand-off at all.
 */
describe("buildTemplateProps — what both render passes are measured against", () => {
  const payload = {
    catalogId: "c1",
    userId: "u1",
    title: "Catálogo",
    branding: null,
    sections: [],
    products: [{ id: "p1", name: "Woofer", categoryL1: "AUDIO", categoryL2: null }],
    productsPerPage: 6,
  };

  it("carries the chosen price tiers through", () => {
    expect(buildTemplateProps({ ...payload, tiers: ["taller"] }, null).tiers).toEqual(["taller"]);
  });

  it("leaves absent tiers absent, so CatalogTemplate owns the one default", () => {
    // Defaulting here too would put the fallback in two places, and the second
    // copy is the one that drifts.
    expect(buildTemplateProps(payload, null).tiers).toBeUndefined();
  });

  /**
   * The two passes differ in exactly one prop, and getting it backwards is
   * invisible everywhere else: `chunkProducts` packs pages from what the
   * measuring pass measured, so a measuring pass that GREW its rows would hand
   * the packer heights no printed page has — fewer products a page, or an
   * overflow, in a PDF a customer reads. Chromium is the only thing that can
   * see the difference, and no unit test runs one.
   *
   * `CatalogTemplate.test.ts` holds the other half: that a grid rendered
   * without the flag declares no row sizing at all.
   */
  it("never lets the measuring pass fill the page — it measures the natural card", () => {
    const props = buildMeasurementProps(buildTemplateProps(payload, null), payload.products);

    expect(props.fillPageHeight).toBe(false);
    expect(props.productPages).toEqual([payload.products]);
  });

  it("fills the page in the print pass, against the split the measurement produced", () => {
    const pages = [[payload.products[0]!], [payload.products[0]!]];
    const props = buildPrintProps(buildTemplateProps(payload, null), pages);

    expect(props.fillPageHeight).toBe(true);
    expect(props.productPages).toBe(pages);
  });

  it("gives the measuring pass no page at all when there are no products", () => {
    expect(buildMeasurementProps(buildTemplateProps(payload, null), []).productPages).toEqual([]);
  });
});

describe("registerPdfGenerateWorker", () => {
  it("wraps the boss.work handler with withJobCapture: a throw is reported with job/jobId tags and pg-boss still sees the rejection", async () => {
    captureException.mockClear();
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue(undefined);
    const boss = { createQueue, work } as unknown as PgBoss;

    await registerPdfGenerateWorker({ getBoss: async () => boss });

    expect(work).toHaveBeenCalledWith(PDF_GENERATE_JOB, { localConcurrency: 1 }, expect.any(Function));
    const registeredHandler = work.mock.calls[0][2] as (jobs: unknown[]) => Promise<void>;
    // Empty jobs array: the site's `async ([job]) => ...` destructures
    // `job` as undefined, so `job.data` throws synchronously — a
    // deterministic failure that needs no real browser/DB.
    await expect(registeredHandler([])).rejects.toBeInstanceOf(TypeError);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(expect.any(TypeError), {
      tags: { job: PDF_GENERATE_JOB, jobId: "unknown" },
    });
  });
});
