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
import { resolveBranding } from "./worker";

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
      coverText: "Bienvenido",
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

    expect(result).toEqual({ templateId: "dforce-classic", logoUrl: null, coverText: null });
  });

  it("yields logoUrl: null without calling getObject() when there is no logoR2Key", async () => {
    const branding: PdfBranding = { templateId: "dforce-classic", logoR2Key: null, logoContentType: null, coverText: "Hola" };
    const getObject = vi.fn();

    const result = await resolveBranding(branding, { getObject });

    expect(getObject).not.toHaveBeenCalled();
    expect(result).toEqual({ templateId: "dforce-classic", logoUrl: null, coverText: "Hola" });
  });
});
