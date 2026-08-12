import { describe, expect, it } from "vitest";

import type { ProductPrintRef } from "@/shared/template/CatalogTemplate";
import { chunkProducts, renderCatalogHtml } from "./render";

function product(id: string): ProductPrintRef {
  return { id, name: `Product ${id}`, categoryL1: "Motor", categoryL2: null };
}

describe("chunkProducts — R6.1/R5.4", () => {
  it("returns no pages for an empty product list", () => {
    expect(chunkProducts([], 10)).toEqual([]);
  });

  it("splits evenly when the count is an exact multiple of productsPerPage", () => {
    const products = ["1", "2", "3", "4"].map(product);
    const pages = chunkProducts(products, 2);
    expect(pages).toHaveLength(2);
    expect(pages[0].map((p) => p.id)).toEqual(["1", "2"]);
    expect(pages[1].map((p) => p.id)).toEqual(["3", "4"]);
  });

  it("puts the remainder on a final shorter page", () => {
    const products = ["1", "2", "3"].map(product);
    const pages = chunkProducts(products, 2);
    expect(pages).toHaveLength(2);
    expect(pages[1]).toHaveLength(1);
  });

  it("treats productsPerPage=1 as one product per page", () => {
    const products = ["1", "2"].map(product);
    expect(chunkProducts(products, 1)).toEqual([[products[0]], [products[1]]]);
  });

  it("falls back to a single page when productsPerPage is invalid (ponytail guard, not reachable via validated input)", () => {
    const products = ["1"].map(product);
    expect(chunkProducts(products, 0)).toEqual([products]);
  });
});

describe("renderCatalogHtml — R6.1 (shares CatalogTemplate with the builder's live preview, Risk-5)", () => {
  it("produces a full HTML document containing the title, index, and every product page", async () => {
    const html = await renderCatalogHtml({
      title: "Catalog: Motor",
      branding: { templateId: "dforce-classic", logoUrl: "https://x/logo.png", coverText: "Welcome" },
      sections: [{ categoryL1: "Motor", categoryL2: null, productCount: 2 }],
      productPages: [["1", "2"].map(product)],
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Catalog: Motor");
    expect(html).toContain("Product 1");
    expect(html).toContain("Product 2");
    expect(html).toContain("Motor");
  });

  it("renders cover+index only (no product-page markup) when productPages is omitted", async () => {
    const html = await renderCatalogHtml({ title: "Empty catalog", branding: null, sections: [] });
    expect(html).toContain("Empty catalog");
    expect(html).not.toContain("Product page");
  });

  // design.md's New Risk #1 — this body `<style>` tag previously read
  // `branding.font` directly and fell back to plain "sans-serif" once that
  // field moved into the registry (D1/D2); it must resolve the SAME font the
  // cover uses, via getTemplate(branding.templateId), not silently drift.
  it("resolves the body font from the registry, not a literal branding.font", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: { templateId: "dforce-classic", logoUrl: null, coverText: null },
      sections: [],
    });
    // Exactly the registry's font string — it already ends in its own
    // fallback, so a second appended "sans-serif" would be a duplicate.
    expect(html).toContain("font-family: Arial, sans-serif;");
  });

  it("falls back to sans-serif when there is no branding at all", async () => {
    const html = await renderCatalogHtml({ title: "C", branding: null, sections: [] });
    expect(html).toContain("font-family: sans-serif;");
  });

  it("renders transparent imageType with full-bleed card (height 180px inline)", async () => {
    const html = await renderCatalogHtml({
      title: "Test",
      branding: null,
      sections: [],
      defaultImageHandling: "adaptive",
      productPages: [[{ id: "1", name: "P1", categoryL1: "Motor", categoryL2: null, image: "https://x/img.png", imageType: "transparent" }]],
    });
    expect(html).toContain("height:180px");
    expect(html).not.toContain("border:1px solid");
  });

  it("renders opaque imageType with polaroid card (height 160px inline)", async () => {
    const html = await renderCatalogHtml({
      title: "Test",
      branding: null,
      sections: [],
      defaultImageHandling: "adaptive",
      productPages: [[{ id: "1", name: "P1", categoryL1: "Motor", categoryL2: null, image: "https://x/img.jpg", imageType: "opaque" }]],
    });
    expect(html).toContain("height:160px");
    expect(html).toContain("border:1px solid");
  });

  it("defaults null imageType to opaque (polaroid card)", async () => {
    const html = await renderCatalogHtml({
      title: "Test",
      branding: null,
      sections: [],
      defaultImageHandling: "adaptive",
      productPages: [[{ id: "1", name: "P1", categoryL1: "Motor", categoryL2: null, image: "https://x/img.jpg", imageType: null }]],
    });
    expect(html).toContain("height:160px");
  });

  it("strict mode uses opaque card regardless of imageType", async () => {
    const html = await renderCatalogHtml({
      title: "Test",
      branding: null,
      sections: [],
      defaultImageHandling: "strict",
      productPages: [[{ id: "1", name: "P1", categoryL1: "Motor", categoryL2: null, image: "https://x/img.png", imageType: "transparent" }]],
    });
    expect(html).toContain("height:160px");
    expect(html).not.toContain("height:180px");
  });

  it("default (null) handling is strict for backward compat", async () => {
    const html = await renderCatalogHtml({
      title: "Test",
      branding: null,
      sections: [],
      productPages: [[{ id: "1", name: "P1", categoryL1: "Motor", categoryL2: null, image: "https://x/img.png", imageType: "transparent" }]],
    });
    expect(html).toContain("height:160px");
    expect(html).not.toContain("height:180px");
  });
});

/**
 * catalog-templates-and-workshop-info WU4 — a catalog no longer carries one
 * admin-chosen price tier; every product prints all three (Venta/Taller/
 * Socio). A tier with no usable price — absent, or an ERP value `<= 0.00` —
 * renders an em-dash, never "$0.00" (design D4).
 */
describe("renderCatalogHtml — product prices", () => {
  const priced = (prices: ProductPrintRef["prices"]): ProductPrintRef[][] => [
    [{ id: "1", name: "Woofer", categoryL1: "AUDIO", categoryL2: null, prices }],
  ];

  it("prints all three resolved tiers on the card", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: null,
      sections: [],
      productPages: priced({ venta: 120, taller: 100, socio: 90 }),
    });

    expect(html).toContain("Venta: $120.00");
    expect(html).toContain("Taller: $100.00");
    expect(html).toContain("Socio: $90.00");
  });

  it("renders an em-dash for the one tier missing, without touching the others", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: null,
      sections: [],
      productPages: priced({ venta: 120, taller: null, socio: 90 }),
    });

    expect(html).toContain("Venta: $120.00");
    expect(html).toContain("Taller: —");
    expect(html).toContain("Socio: $90.00");
  });

  // 32 of 694 real products have no retail price. Printing "$0.00" beside one
  // in a document handed to a customer is worse than printing nothing.
  it("renders three em-dashes when every tier has no usable price", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: null,
      sections: [],
      productPages: priced({ venta: null, taller: null, socio: null }),
    });

    expect(html).not.toContain("$");
    expect(html).toContain("Venta: —");
    expect(html).toContain("Taller: —");
    expect(html).toContain("Socio: —");
  });

  it("renders em-dashes when prices is absent entirely", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: null,
      sections: [],
      productPages: [[{ id: "1", name: "Woofer", categoryL1: "AUDIO", categoryL2: null }]],
    });

    expect(html).not.toContain("$");
    expect(html).toContain("Venta: —");
  });

  // A hostile/real ERP "0.00" tier must never render as free.
  it("renders a zero-value tier as an em-dash, never $0.00", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: null,
      sections: [],
      productPages: priced({ venta: 0, taller: 100, socio: 0 }),
    });

    expect(html).not.toContain("$0.00");
    expect(html).toContain("Taller: $100.00");
  });
});

/**
 * catalog-templates-and-workshop-info WU5 (design D6, spec: "Workshop
 * Contact Block on Cover") — closes the CRITICAL sdd-verify finding: the
 * contact columns and the cover image WU1/WU5 store had no render path.
 * Tested through `renderCatalogHtml` (not a separate `CatalogTemplate.test.tsx`),
 * same precedent as WU3's task 3.1 — `CatalogTemplate` is a plain function
 * component already exercised here via `renderToStaticMarkup`.
 */
describe("renderCatalogHtml — workshop contact page (design D6)", () => {
  const fullContact = {
    name: "Dforce Car Audio",
    phone: "+507 6123-4567",
    whatsapp: "+507 6987-6543",
    email: "ventas@dforcecaraudio.com",
    address: "Vía España, Local 12",
    hours: "Lunes a sábado · 8:00 a 18:00",
    website: "www.dforcecaraudio.com",
    socialHandles: { instagram: "@dforcecaraudio", facebook: "@dforcecaraudio" },
  };

  it("renders every set contact field", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: { templateId: "dforce-classic", logoUrl: null, coverText: null, contact: fullContact },
      sections: [],
    });

    expect(html).toContain("+507 6123-4567");
    expect(html).toContain("+507 6987-6543");
    expect(html).toContain("ventas@dforcecaraudio.com");
    expect(html).toContain("Vía España, Local 12");
    expect(html).toContain("Lunes a sábado · 8:00 a 18:00");
    expect(html).toContain("www.dforcecaraudio.com");
    expect(html).toContain("Dforce Car Audio");
  });

  // spec, verbatim: "A field left unset by the Administrador MUST simply be
  // omitted from the block, never rendered as an empty label."
  it("omits the label entirely for an unset field, never an empty label", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: {
        templateId: "dforce-classic",
        logoUrl: null,
        coverText: null,
        contact: { ...fullContact, whatsapp: null, address: null, website: null, socialHandles: null },
      },
      sections: [],
    });

    expect(html).toContain("+507 6123-4567");
    expect(html).not.toContain("WHATSAPP");
    expect(html).not.toContain("DIRECCIÓN");
    expect(html).not.toContain("SITIO WEB");
    expect(html).not.toContain("SEGUINOS EN REDES");
  });

  it("iterates socialHandles entries generically, never hardcoding a platform name", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: {
        templateId: "dforce-classic",
        logoUrl: null,
        coverText: null,
        contact: { ...fullContact, socialHandles: { unKnownPlatform: "@handle" } },
      },
      sections: [],
    });

    expect(html).toContain("unKnownPlatform");
    expect(html).toContain("@handle");
  });

  /**
   * `workshop_config` is a singleton row that WU1's migration guarantees
   * exists, so `buildWorkshopContact` returns an OBJECT OF NULLS — never
   * `null` — for a workshop that simply has not filled contact info in yet.
   * Guarding on `contact != null` alone therefore appended a blank black page
   * to every catalog from such a workshop.
   */
  it("renders no contact page when every contact field is null, not a blank page", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      sections: [],
      branding: {
        templateId: "dforce-classic",
        logoUrl: null,
        coverText: null,
        contact: {
          name: null,
          phone: null,
          whatsapp: null,
          email: null,
          address: null,
          hours: null,
          website: null,
          socialHandles: null,
        },
      },
    });
    expect(html).not.toContain('aria-label="Contact"');
  });

  it("renders no contact page at all when contact is null, not an empty one", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: { templateId: "dforce-classic", logoUrl: null, coverText: null, contact: null },
      sections: [],
    });

    expect(html).not.toContain("SEGUINOS EN REDES");
    expect(html).not.toContain("TELÉFONO");
  });

  it("renders the cover image when coverImageUrl is set", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: { templateId: "dforce-classic", logoUrl: null, coverText: null, coverImageUrl: "data:image/jpeg;base64,Zm9v" },
      sections: [],
    });

    expect(html).toContain("data:image/jpeg;base64,Zm9v");
  });

  // Hard constraint #4 — a missing cover image degrades to the template's
  // red/black block; never a broken <img>, never an empty page.
  it("renders no <img> for the cover photo when coverImageUrl is null, degrading to the red/black block", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: { templateId: "dforce-classic", logoUrl: null, coverText: null, coverImageUrl: null },
      sections: [],
    });

    expect(html).toContain('aria-label="Cover"');
    expect(html).not.toMatch(/<img[^>]*alt=""/);
  });
});

describe("renderCatalogHtml — product prices", () => {
  it("prints the prices on the transparent card too, not just the framed one", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: null,
      sections: [],
      defaultImageHandling: "adaptive",
      productPages: [
        [
          {
            id: "1",
            name: "Woofer",
            categoryL1: "AUDIO",
            categoryL2: null,
            imageType: "transparent",
            prices: { venta: 45, taller: null, socio: null },
          },
        ],
      ],
    });

    expect(html).toContain("Venta: $45.00");
  });
});
