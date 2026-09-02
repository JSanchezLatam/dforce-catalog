/**
 * Unit tests for `categories.ts` (C4, task 2.1, design.md D3). Purely
 * structural: a `ServiceCategory` alias + a `CATEGORIA_LABEL` map, so the
 * whole spec surface is "every enum value has a label" plus a couple of
 * spot-checked Spanish strings (spec §"Service Category Vocabulary").
 */
import { describe, expect, it } from "vitest";

import { ordenCategoriaEnum } from "@/shared/db/schema";
import { CATEGORIA_LABEL } from "./categories";

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
