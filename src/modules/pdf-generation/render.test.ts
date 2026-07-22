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
      branding: { logoUrl: "https://x/logo.png", primaryColors: { primary: "#111111", secondary: "#eeeeee" }, font: "Arial", coverText: "Welcome" },
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
});
