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
import { describe, expect, it, vi } from "vitest";

import type { PdfBranding } from "./enqueue";
import { resolveBranding, buildTemplateProps } from "./worker";

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
});
