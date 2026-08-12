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
    expect(html).toContain("font-family: Arial, sans-serif,");
  });

  it("falls back to sans-serif when there is no branding at all", async () => {
    const html = await renderCatalogHtml({ title: "C", branding: null, sections: [] });
    expect(html).toContain("font-family: sans-serif,");
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
 * A catalog carries exactly ONE price tier — whichever the admin picked at
 * generation time — already resolved into `price` by the builder. The template
 * never sees the other two, so a trade or member price cannot leak into a
 * retail catalog through the payload.
 */
describe("renderCatalogHtml — product prices", () => {
  const priced = (price: number | null): ProductPrintRef[][] => [
    [{ id: "1", name: "Woofer", categoryL1: "AUDIO", categoryL2: null, price }],
  ];

  it("prints the resolved price on the card", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: null,
      sections: [],
      productPages: priced(45),
    });

    expect(html).toContain("45.00");
  });

  it("formats a whole number to two decimals rather than bare", async () => {
    const html = await renderCatalogHtml({ title: "C", branding: null, sections: [], productPages: priced(38) });

    expect(html).toContain("38.00");
    expect(html).not.toContain(">38<");
  });

  // 32 of 694 real products have no retail price. Printing "$0.00" beside one
  // in a document handed to a customer is worse than printing nothing.
  it("prints nothing at all when the product has no price", async () => {
    const html = await renderCatalogHtml({ title: "C", branding: null, sections: [], productPages: priced(null) });

    expect(html).not.toContain("0.00");
    expect(html).not.toContain("$");
  });

  it("omits the price when the field is absent entirely", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: null,
      sections: [],
      productPages: [[{ id: "1", name: "Woofer", categoryL1: "AUDIO", categoryL2: null }]],
    });

    expect(html).not.toContain("$");
  });

  it("prints the price on the transparent card too, not just the framed one", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: null,
      sections: [],
      defaultImageHandling: "adaptive",
      productPages: [
        [{ id: "1", name: "Woofer", categoryL1: "AUDIO", categoryL2: null, imageType: "transparent", price: 45 }],
      ],
    });

    expect(html).toContain("45.00");
  });
});
