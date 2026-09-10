/**
 * Shape invariants for the curated vehicle catalog (design.md D13, D20).
 *
 * ~300 lines of the module under test are data rows nobody can review from
 * memory — nobody here can confirm whether Chery sells a Tiggo 7 Pro in
 * Panama. What IS reviewable, and what this file asserts, is the shape: the
 * make SET (never a count — this list was already miscounted once before it
 * reached the spec), sort order, no duplicates, every make non-empty, and the
 * four Toyota models that are the tripwire against regenerating this file
 * from a US-registration data source (vpic.nhtsa.dot.gov / us-car-models-data
 * both omit exactly these four).
 */
import { describe, expect, it } from "vitest";

import { OTHER, VEHICLE_CATALOG, VEHICLE_MAKES, modelsForMake } from "./vehicle-catalog";

/** The owner's settled list (design.md WU3 preamble): "agregá Lexus, no saques ninguna". A SET, never a count. */
const EXPECTED_MAKES = [
  "Toyota",
  "Nissan",
  "Honda",
  "Mitsubishi",
  "Suzuki",
  "Mazda",
  "Isuzu",
  "Subaru",
  "Daihatsu",
  "Lexus",
  "Hyundai",
  "Kia",
  "SsangYong",
  "Chery",
  "Great Wall",
  "Haval",
  "JAC",
  "BYD",
  "Changan",
  "Geely",
  "MG",
  "Foton",
  "Dongfeng",
  "BAIC",
  "Chevrolet",
  "Ford",
  "Jeep",
  "Dodge",
  "RAM",
  "GMC",
  "Volkswagen",
  "Mercedes-Benz",
  "BMW",
  "Audi",
  "Peugeot",
  "Renault",
  "Volvo",
  "Land Rover",
  "Fiat",
  "Mahindra",
  "Tata",
].sort();

describe("vehicle-catalog shape invariants", () => {
  it("the make set equals exactly the spec's enumerated list", () => {
    expect([...VEHICLE_MAKES].sort()).toEqual(EXPECTED_MAKES);
  });

  it("make keys are in a single deterministic (sorted) order", () => {
    expect(VEHICLE_MAKES).toEqual([...VEHICLE_MAKES].sort());
  });

  it("no duplicate make key", () => {
    expect(new Set(VEHICLE_MAKES).size).toBe(VEHICLE_MAKES.length);
  });

  it("every make has at least one model", () => {
    for (const make of VEHICLE_MAKES) {
      expect(VEHICLE_CATALOG[make].length).toBeGreaterThan(0);
    }
  });

  it("every model is non-empty and trimmed", () => {
    for (const make of VEHICLE_MAKES) {
      for (const model of VEHICLE_CATALOG[make]) {
        expect(model.length).toBeGreaterThan(0);
        expect(model).toBe(model.trim());
      }
    }
  });

  it("no duplicate model within a make", () => {
    for (const make of VEHICLE_MAKES) {
      const models = VEHICLE_CATALOG[make];
      expect(new Set(models).size).toBe(models.length);
    }
  });

  it("no make is named \"Otro\" or collides with the escape sentinel", () => {
    expect(VEHICLE_MAKES).not.toContain("Otro");
    expect(VEHICLE_MAKES).not.toContain(OTHER);
  });

  it("Toyota carries the four models vPIC omits (Hilux, Fortuner, Land Cruiser Prado, Rush)", () => {
    expect(VEHICLE_CATALOG.Toyota).toEqual(
      expect.arrayContaining(["Hilux", "Fortuner", "Land Cruiser Prado", "Rush"]),
    );
  });
});

describe("modelsForMake", () => {
  it("returns the catalog's model list for a known make", () => {
    expect(modelsForMake("Toyota")).toBe(VEHICLE_CATALOG.Toyota);
  });

  /**
   * The prototype chain is the real case here, and the name used to promise
   * "never a throw" while probing one ordinary string. `VEHICLE_CATALOG` is a
   * plain object literal, so `constructor`, `valueOf` and `toString` all
   * ANSWER — and a `?? []` never fires for them because they are not nullish.
   * `modelsForMake("constructor")` returned the Object constructor, a function
   * whose `.length` is 1, which sailed past the caller's emptiness check.
   *
   * Not theoretical: free text is a REQUIREMENT of this capability, so a
   * technician typing `constructor` into "Especificá la marca" is input the
   * contract invites.
   */
  it("returns an empty array for an unknown make, including inherited Object keys", () => {
    for (const key of ["constructor", "valueOf", "toString", "hasOwnProperty", "__proto__"]) {
      expect(modelsForMake(key)).toEqual([]);
    }
  });

  it("returns an empty array, never a throw, for an unknown make", () => {
    expect(() => modelsForMake("Hino")).not.toThrow();
    expect(modelsForMake("Hino")).toEqual([]);
  });
});
