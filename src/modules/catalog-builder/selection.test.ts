import { describe, expect, it } from "vitest";

import {
  applySelection,
  buildIndexSections,
  CatalogSelectionValidationError,
  deriveCatalogTitle,
  MAX_TOTAL_PRODUCTS,
  matchesAnyCategory,
  validateCatalogSelection,
  type ProductRef,
} from "./selection";

const products: ProductRef[] = [
  { id: "1", name: "A", categoryL1: "Motor", categoryL2: "Bombas" },
  { id: "2", name: "B", categoryL1: "Motor", categoryL2: "Filtros" },
  { id: "3", name: "C", categoryL1: "Motor", categoryL2: "Bombas" },
  { id: "4", name: "D", categoryL1: "Accesorios", categoryL2: null },
];

describe("matchesAnyCategory (R5.1)", () => {
  it("matches a product when an L1-only ref covers its category", () => {
    expect(matchesAnyCategory(products[0], [{ categoryL1: "Motor" }])).toBe(true);
  });

  it("matches a product only against the exact L2 when an L1+L2 ref is given", () => {
    expect(matchesAnyCategory(products[0], [{ categoryL1: "Motor", categoryL2: "Filtros" }])).toBe(false);
    expect(matchesAnyCategory(products[1], [{ categoryL1: "Motor", categoryL2: "Filtros" }])).toBe(true);
  });
});

describe("applySelection (R5.2/5.3)", () => {
  it("excludes an entire L2 subcategory even though its L1 parent is included", () => {
    const result = applySelection(products, [{ categoryL1: "Motor", categoryL2: "Bombas" }], []);
    expect(result.map((p) => p.id)).toEqual(["2", "4"]);
  });

  it("excludes a specific product id without affecting siblings in the same category", () => {
    const result = applySelection(products, [], ["1"]);
    expect(result.map((p) => p.id)).toEqual(["2", "3", "4"]);
  });

  it("applies category and product exclusions together", () => {
    const result = applySelection(products, [{ categoryL1: "Accesorios" }], ["2"]);
    expect(result.map((p) => p.id)).toEqual(["1", "3"]);
  });
});

describe("buildIndexSections (R5.5/5.6)", () => {
  it("groups the final set by category with per-section counts", () => {
    const sections = buildIndexSections(products);
    expect(sections).toEqual([
      { categoryL1: "Accesorios", categoryL2: null, productCount: 1 },
      { categoryL1: "Motor", categoryL2: "Bombas", productCount: 2 },
      { categoryL1: "Motor", categoryL2: "Filtros", productCount: 1 },
    ]);
  });

  it("returns no sections for an empty product list", () => {
    expect(buildIndexSections([])).toEqual([]);
  });
});

describe("deriveCatalogTitle (R5.5)", () => {
  it("joins the included L1 category names", () => {
    expect(deriveCatalogTitle(["Motor", "Accesorios"])).toBe("Catalog: Motor, Accesorios");
  });

  it("falls back to a plain title with no categories selected", () => {
    expect(deriveCatalogTitle([])).toBe("Catalog");
  });
});

describe("validateCatalogSelection (R5.4/5.7/5.8-9)", () => {
  const valid = { includedCategoryCount: 1, totalProductCount: 10, productsPerPage: 10 };

  it("accepts a valid selection", () => {
    expect(() => validateCatalogSelection(valid)).not.toThrow();
  });

  it("rejects zero categories selected", () => {
    expect(() => validateCatalogSelection({ ...valid, includedCategoryCount: 0 })).toThrow(
      CatalogSelectionValidationError,
    );
  });

  it("rejects zero products selected even when categories are selected (R13 scenario 3)", () => {
    try {
      validateCatalogSelection({ ...valid, totalProductCount: 0 });
      expect.fail("expected validation to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CatalogSelectionValidationError);
      expect((err as CatalogSelectionValidationError).errors.total).toBe("No products selected");
    }
  });

  it("rejects a total over the 200-product cap with the current total in the message", () => {
    try {
      validateCatalogSelection({ ...valid, totalProductCount: MAX_TOTAL_PRODUCTS + 35 });
      expect.fail("expected validation to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CatalogSelectionValidationError);
      expect((err as CatalogSelectionValidationError).errors.total).toBe("235 selected, max 200");
    }
  });

  it("accepts exactly 200 products (boundary, not over the cap)", () => {
    expect(() => validateCatalogSelection({ ...valid, totalProductCount: MAX_TOTAL_PRODUCTS })).not.toThrow();
  });

  it("rejects productsPerPage below 1", () => {
    expect(() => validateCatalogSelection({ ...valid, productsPerPage: 0 })).toThrow(CatalogSelectionValidationError);
  });

  it("rejects productsPerPage above 20", () => {
    expect(() => validateCatalogSelection({ ...valid, productsPerPage: 21 })).toThrow(CatalogSelectionValidationError);
  });

  it("rejects a non-integer productsPerPage", () => {
    expect(() => validateCatalogSelection({ ...valid, productsPerPage: 5.5 })).toThrow(CatalogSelectionValidationError);
  });

  it("collects all field errors on the thrown error, not just the first", () => {
    try {
      validateCatalogSelection({ includedCategoryCount: 0, totalProductCount: MAX_TOTAL_PRODUCTS + 1, productsPerPage: 0 });
      expect.fail("expected validation to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CatalogSelectionValidationError);
      expect(Object.keys((err as CatalogSelectionValidationError).errors).sort()).toEqual(
        ["categories", "productsPerPage", "total"].sort(),
      );
    }
  });
});
