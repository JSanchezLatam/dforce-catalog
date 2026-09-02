/**
 * Unit tests for `categories.ts` (C4, task 2.1, design.md D3). Purely
 * structural: a `ServiceCategory` alias + a `CATEGORIA_LABEL` map, so the
 * whole spec surface is "every enum value has a label" plus a couple of
 * spot-checked Spanish strings (spec §"Service Category Vocabulary").
 */
import { describe, expect, it } from "vitest";

import { ordenCategoriaEnum } from "@/shared/db/schema";
import { CATEGORIA_LABEL, isServiceCategory } from "./categories";

describe("CATEGORIA_LABEL", () => {
  it("covers every ordenCategoriaEnum.enumValues entry with a non-empty label", () => {
    for (const value of ordenCategoriaEnum.enumValues) {
      expect(CATEGORIA_LABEL[value]).toEqual(expect.any(String));
      expect(CATEGORIA_LABEL[value].length).toBeGreaterThan(0);
    }
  });

  it("labels revisado as REVISADO, the Panamanian ATTT inspection, not a translated term", () => {
    expect(CATEGORIA_LABEL.revisado).toBe("REVISADO");
  });

  it("labels mant_preventivo distinctly from mant_correctivo", () => {
    expect(CATEGORIA_LABEL.mant_preventivo).toBe("Mant. Preventivo");
    expect(CATEGORIA_LABEL.mant_correctivo).toBe("Mant. Correctivo");
  });
});

describe("isServiceCategory", () => {
  it("accepts every ordenCategoriaEnum value", () => {
    for (const value of ordenCategoriaEnum.enumValues) {
      expect(isServiceCategory(value)).toBe(true);
    }
  });

  it("rejects a string that is not one of the enum values", () => {
    expect(isServiceCategory("banana")).toBe(false);
    expect(isServiceCategory("")).toBe(false);
    expect(isServiceCategory("Instalación")).toBe(false);
    // The guard reads CATEGORIA_LABEL's own keys, so `in` would have said yes
    // to every Object.prototype member. Object.hasOwn is why these are false.
    expect(isServiceCategory("toString")).toBe(false);
    expect(isServiceCategory("constructor")).toBe(false);
  });

  it("rejects non-string input, so a JSON body cannot smuggle one past the guard", () => {
    expect(isServiceCategory(null)).toBe(false);
    expect(isServiceCategory(undefined)).toBe(false);
    expect(isServiceCategory(1)).toBe(false);
    expect(isServiceCategory(["revisado"])).toBe(false);
    expect(isServiceCategory({ categoria: "revisado" })).toBe(false);
  });
});
