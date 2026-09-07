import { describe, expect, it } from "vitest";

import {
  applySelection,
  buildIndexSections,
  CatalogSelectionValidationError,
  deriveCatalogTitle,
  MAX_TOTAL_PRODUCTS,
  matchesAnyCategory,
  toggleBulkFrame,
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
      expect((err as CatalogSelectionValidationError).errors.total).toBe("No seleccionaste ningún producto");
    }
  });

  it("rejects a total over the 200-product cap with the current total in the message", () => {
    try {
      validateCatalogSelection({ ...valid, totalProductCount: MAX_TOTAL_PRODUCTS + 35 });
      expect.fail("expected validation to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CatalogSelectionValidationError);
      expect((err as CatalogSelectionValidationError).errors.total).toBe("Seleccionaste 235, el máximo es 200");
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

/**
 * The bulk "frame all" toggle. Its one-way version — force every product
 * opaque, never restore — is the regression `tasks.md` 3.1 fixed and 5.2 could
 * never pin, because the fix lives in state the presentational
 * `ProductLayoutTuner` does not own.
 */
describe("toggleBulkFrame", () => {
  const PRODUCTS: ProductRef[] = [
    { id: "p1", name: "Woofer", categoryL1: "AUDIO", categoryL2: null, imageType: "transparent" },
    { id: "p2", name: "Tweeter", categoryL1: "AUDIO", categoryL2: null, imageType: "low_res" },
  ];

  it("forces every product opaque when switched on", () => {
    const next = toggleBulkFrame({ overrides: {}, bulkFramed: false, snapshot: {} }, PRODUCTS);

    expect(next.bulkFramed).toBe(true);
    expect(next.overrides).toEqual({ p1: "opaque", p2: "opaque" });
  });

  it("snapshots the pre-bulk overrides on the way in", () => {
    const before = { p1: "transparent" as const };

    const next = toggleBulkFrame({ overrides: before, bulkFramed: false, snapshot: {} }, PRODUCTS);

    expect(next.snapshot).toEqual(before);
  });

  // The actual defect: toggling off used to leave every product forced opaque,
  // silently discarding per-product choices the user had made by hand.
  it("restores the exact pre-bulk overrides when switched off", () => {
    const before = { p1: "transparent" as const, p2: null };

    const on = toggleBulkFrame({ overrides: before, bulkFramed: false, snapshot: {} }, PRODUCTS);
    const off = toggleBulkFrame(on, PRODUCTS);

    expect(off.bulkFramed).toBe(false);
    expect(off.overrides).toEqual(before);
  });

  it("round-trips to the same state, so on/off is not lossy", () => {
    const before = { p1: "low_res" as const };
    const start = { overrides: before, bulkFramed: false, snapshot: {} };

    const after = toggleBulkFrame(toggleBulkFrame(start, PRODUCTS), PRODUCTS);

    expect(after.overrides).toEqual(start.overrides);
    expect(after.bulkFramed).toBe(start.bulkFramed);
  });

  it("restores an empty override map rather than leaving products framed", () => {
    const on = toggleBulkFrame({ overrides: {}, bulkFramed: false, snapshot: {} }, PRODUCTS);
    const off = toggleBulkFrame(on, PRODUCTS);

    expect(off.overrides).toEqual({});
  });

  // Mutating the caller's object would make the snapshot alias live state and
  // quietly defeat the restore it exists for.
  it("does not mutate the state it is given", () => {
    const overrides = { p1: "transparent" as const };
    const state = { overrides, bulkFramed: false, snapshot: {} };

    toggleBulkFrame(state, PRODUCTS);

    expect(state.overrides).toEqual({ p1: "transparent" });
    expect(state.bulkFramed).toBe(false);
  });
});

/**
 * R13 — the catalog prints between one and two price lists, chosen per
 * generation. The cap lives HERE and nowhere else: `AdaptiveCards` is a dumb
 * renderer that prints the rows it is handed, and the route re-runs this same
 * pure function, so client and server cannot drift.
 */
describe("validateCatalogSelection — price tiers", () => {
  const valid = { includedCategoryCount: 1, totalProductCount: 5, productsPerPage: 6 };

  it("accepts one tier", () => {
    expect(() => validateCatalogSelection({ ...valid, tiers: ["venta"] })).not.toThrow();
  });

  it("accepts two tiers", () => {
    expect(() => validateCatalogSelection({ ...valid, tiers: ["venta", "socio"] })).not.toThrow();
  });

  it("rejects an empty selection — a card with no price row is not a catalog", () => {
    expect(() => validateCatalogSelection({ ...valid, tiers: [] })).toThrow(CatalogSelectionValidationError);
  });

  it("rejects three, which is the whole point of the cap", () => {
    try {
      validateCatalogSelection({ ...valid, tiers: ["venta", "taller", "socio"] });
      expect.unreachable("three tiers must be rejected");
    } catch (err) {
      expect((err as CatalogSelectionValidationError).errors.tiers).toBeDefined();
    }
  });

  it("rejects an unknown tier name rather than silently dropping it", () => {
    // Silently ignoring it would print a one-row catalog for a request that
    // asked for two, and nothing would say why.
    expect(() =>
      validateCatalogSelection({ ...valid, tiers: ["venta", "mayorista"] as never }),
    ).toThrow(CatalogSelectionValidationError);
  });

  it("rejects the same tier twice — two boxes ticked, one row printed", () => {
    expect(() => validateCatalogSelection({ ...valid, tiers: ["venta", "venta"] })).toThrow(
      CatalogSelectionValidationError,
    );
  });

  /**
   * Absent is NOT invalid: jobs enqueued before tier selection existed carry
   * no `tiers`, and `CatalogTemplate` defaults them. Rejecting here would fail
   * a re-validation of a payload that is legitimately old.
   */
  it("accepts an omitted selection and leaves the default to the renderer", () => {
    expect(() => validateCatalogSelection(valid)).not.toThrow();
  });
});
