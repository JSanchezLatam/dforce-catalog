/**
 * Trust-boundary tests for the generate endpoint's body guard.
 *
 * This payload does not get consumed by the request that posts it — it is
 * handed to a pg-boss job and rendered by a Playwright worker minutes later.
 * A bad field here does not produce a 400 the caller can see; it produces a
 * `TypeError` in a decoupled background process with nobody to report it to.
 * That is why element shape is checked and not just `Array.isArray`.
 */
import { describe, expect, it } from "vitest";

import { isGenerateBody } from "./route";

const VALID = {
  title: "Catálogo",
  sections: [{ categoryL1: "AUDIO", categoryL2: null, productCount: 2 }],
  products: [{ id: "p1", name: "Woofer", categoryL1: "AUDIO", categoryL2: null, price: 45 }],
  productsPerPage: 10,
  includedCategoryCount: 1,
};

describe("isGenerateBody — the envelope", () => {
  it("accepts a well-formed body", () => {
    expect(isGenerateBody(VALID)).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(isGenerateBody(null)).toBe(false);
    expect(isGenerateBody("nope")).toBe(false);
  });

  it("rejects a missing or mistyped scalar field", () => {
    expect(isGenerateBody({ ...VALID, title: 42 })).toBe(false);
    expect(isGenerateBody({ ...VALID, productsPerPage: "10" })).toBe(false);
    expect(isGenerateBody({ ...VALID, includedCategoryCount: null })).toBe(false);
  });
});

describe("isGenerateBody — product element shape", () => {
  // The exact failure this guard exists for: `price` arrives as a string, the
  // job enqueues fine, and `price.toFixed(2)` throws inside the PDF worker.
  it("rejects a price sent as a string", () => {
    expect(isGenerateBody({ ...VALID, products: [{ ...VALID.products[0], price: "45" }] })).toBe(false);
  });

  it("accepts a null or absent price, which means 'no usable price'", () => {
    expect(isGenerateBody({ ...VALID, products: [{ ...VALID.products[0], price: null }] })).toBe(true);
    const { price: _price, ...noPrice } = VALID.products[0];
    expect(isGenerateBody({ ...VALID, products: [noPrice] })).toBe(true);
  });

  it("rejects a non-finite price rather than printing NaN on a page", () => {
    expect(isGenerateBody({ ...VALID, products: [{ ...VALID.products[0], price: Number.NaN }] })).toBe(false);
  });

  it("rejects a product whose id or name is not a string", () => {
    expect(isGenerateBody({ ...VALID, products: [{ ...VALID.products[0], id: 7 }] })).toBe(false);
    expect(isGenerateBody({ ...VALID, products: [{ ...VALID.products[0], name: null }] })).toBe(false);
  });

  it("rejects a non-object product element", () => {
    expect(isGenerateBody({ ...VALID, products: ["woofer"] })).toBe(false);
    expect(isGenerateBody({ ...VALID, products: [null] })).toBe(false);
  });

  it("accepts an empty product list — the emptiness rule belongs to validateCatalogSelection", () => {
    expect(isGenerateBody({ ...VALID, products: [] })).toBe(true);
  });
});

describe("isGenerateBody — section element shape", () => {
  it("rejects a section with a non-string categoryL1", () => {
    expect(isGenerateBody({ ...VALID, sections: [{ categoryL1: 1, categoryL2: null, productCount: 2 }] })).toBe(false);
  });

  it("rejects a section whose productCount is not a number", () => {
    expect(
      isGenerateBody({ ...VALID, sections: [{ categoryL1: "AUDIO", categoryL2: null, productCount: "2" }] }),
    ).toBe(false);
  });

  it("accepts a null categoryL2, which is the L1-only case", () => {
    expect(isGenerateBody({ ...VALID, sections: [{ categoryL1: "AUDIO", categoryL2: null, productCount: 2 }] })).toBe(
      true,
    );
  });
});
