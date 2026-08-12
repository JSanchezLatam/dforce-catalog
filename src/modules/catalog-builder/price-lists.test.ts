import { describe, expect, it } from "vitest";

import {
  IFX_PRICE_LIST_NAMES,
  PRICE_LIST_LABELS,
  PRICE_LISTS,
  resolveAllPrices,
  resolvePrice,
  type PriceListMap,
} from "./price-lists";

/** Shape as it comes back from the query: Interfuerza's own list names, values as strings. */
const REAL: PriceListMap = {
  "Precio de venta": "45.00",
  "PRECIO TALLER": "38.00",
  "Precio Socio": "32.00",
};

describe("resolvePrice — picking one tier", () => {
  it("returns the retail price for venta", () => {
    expect(resolvePrice(REAL, "venta")).toBe(45);
  });

  it("returns the trade price for taller", () => {
    expect(resolvePrice(REAL, "taller")).toBe(38);
  });

  it("returns the member price for socio", () => {
    expect(resolvePrice(REAL, "socio")).toBe(32);
  });

  it("parses the string values Interfuerza sends, not NaN", () => {
    expect(resolvePrice({ "Precio de venta": "5.50" }, "venta")).toBe(5.5);
  });
});

/**
 * 32 of 694 real products carry "0.00" for Precio de venta — all of them with
 * zero stock. A catalog is a printed document handed to a customer: "$0.00" on
 * one is worse than no price at all, so zero reads as absent, never as free.
 */
describe("resolvePrice — when there is no usable price", () => {
  it("treats 0.00 as absent rather than free", () => {
    expect(resolvePrice({ "Precio de venta": "0.00" }, "venta")).toBeNull();
  });

  it("returns null when that tier is missing from the map", () => {
    expect(resolvePrice({ "Precio de venta": "45.00" }, "socio")).toBeNull();
  });

  it("returns null for a null or empty map", () => {
    expect(resolvePrice(null, "venta")).toBeNull();
    expect(resolvePrice({}, "venta")).toBeNull();
  });

  it("returns null rather than NaN for an unparseable value", () => {
    expect(resolvePrice({ "Precio de venta": "" }, "venta")).toBeNull();
    expect(resolvePrice({ "Precio de venta": "n/a" }, "venta")).toBeNull();
  });

  // Interfuerza has one product priced above retail for the trade tier
  // (BASE AMORT DEL HONDA CR-V 07-16: venta 23.83, taller 35.00). That is an
  // upstream data-entry error, not something to silently "correct" here — the
  // catalog must print what the ERP says.
  it("does not second-guess a tier priced above retail", () => {
    expect(resolvePrice({ "Precio de venta": "23.83", "PRECIO TALLER": "35.00" }, "taller")).toBe(35);
  });
});

/**
 * The `Name` values carry trailing whitespace in real data — exactly the
 * gotcha `Category_L1/L2` already has. The SQL trims on the way out, but a
 * caller building this map by hand (tests, fixtures, a future importer) must
 * not be punished for it.
 */
describe("resolvePrice — the trailing-whitespace trap", () => {
  it("matches a list name that still carries its trailing space", () => {
    expect(resolvePrice({ "PRECIO TALLER ": "38.00" }, "taller")).toBe(38);
  });

  it("matches regardless of surrounding whitespace on either side", () => {
    expect(resolvePrice({ "  Precio Socio  ": "32.00" }, "socio")).toBe(32);
  });
});

describe("the price-list vocabulary", () => {
  it("covers exactly the three lists Interfuerza sends", () => {
    expect([...PRICE_LISTS]).toEqual(["venta", "taller", "socio"]);
  });

  it("has a Spanish label for every list, for the generate-step selector", () => {
    for (const list of PRICE_LISTS) {
      expect(PRICE_LIST_LABELS[list]).toBeTruthy();
    }
  });

  // These strings are the contract with the ERP. Changing one silently drops a
  // whole tier to null across every catalog, so they are pinned here.
  it("pins the exact ERP name behind each list", () => {
    expect(IFX_PRICE_LIST_NAMES).toEqual({
      venta: "Precio de venta",
      taller: "PRECIO TALLER",
      socio: "Precio Socio",
    });
  });
});

/**
 * catalog-templates-and-workshop-info WU4 (task 4.1) — the catalog now prints
 * all three tiers per product instead of collapsing to one admin-chosen list.
 * `resolveAllPrices` wraps `resolvePrice` per tier, so the `<= 0 → null`
 * absent-price rule is preserved independently for each one.
 */
describe("resolveAllPrices — all three tiers at once", () => {
  it("resolves venta/taller/socio independently from the same map", () => {
    expect(resolveAllPrices(REAL)).toEqual({ venta: 45, taller: 38, socio: 32 });
  });

  it("nulls only the tier with no usable price, leaving the others resolved", () => {
    expect(resolveAllPrices({ "Precio de venta": "45.00", "PRECIO TALLER": "0.00" })).toEqual({
      venta: 45,
      taller: null,
      socio: null,
    });
  });

  it("returns all three tiers null for a null or empty map", () => {
    expect(resolveAllPrices(null)).toEqual({ venta: null, taller: null, socio: null });
    expect(resolveAllPrices({})).toEqual({ venta: null, taller: null, socio: null });
  });
});
