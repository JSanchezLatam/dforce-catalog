import { describe, expect, it } from "vitest";

import { getTemplateConfig, saveTemplateConfig, TemplateConfigValidationError, validateTemplateConfigInput } from "./service";

const validInput = {
  logoUrl: "https://example.com/logo.png",
  primaryColors: { primary: "#112233", secondary: "#445566" },
  font: "Arial, sans-serif",
  coverText: "Dforce Car — Catalogo 2026",
  defaultImageHandling: null,
  selectedTemplateId: null,
};

describe("validateTemplateConfigInput (R8.1)", () => {
  it("accepts a fully valid input and returns it unchanged", () => {
    expect(validateTemplateConfigInput(validInput)).toEqual(validInput);
  });

  it("rejects a non-URL logoUrl", () => {
    expect(() => validateTemplateConfigInput({ ...validInput, logoUrl: "not-a-url" })).toThrow(
      TemplateConfigValidationError,
    );
  });

  it("rejects a missing logoUrl", () => {
    expect(() => validateTemplateConfigInput({ ...validInput, logoUrl: "" })).toThrow(
      TemplateConfigValidationError,
    );
  });

  it("rejects a non-hex primary color", () => {
    expect(() =>
      validateTemplateConfigInput({ ...validInput, primaryColors: { primary: "blue", secondary: "#445566" } }),
    ).toThrow(TemplateConfigValidationError);
  });

  it("rejects a non-hex secondary color", () => {
    expect(() =>
      validateTemplateConfigInput({ ...validInput, primaryColors: { primary: "#112233", secondary: "red" } }),
    ).toThrow(TemplateConfigValidationError);
  });

  it("rejects an empty font", () => {
    expect(() => validateTemplateConfigInput({ ...validInput, font: "  " })).toThrow(TemplateConfigValidationError);
  });

  it("rejects a font over the max length", () => {
    expect(() => validateTemplateConfigInput({ ...validInput, font: "a".repeat(101) })).toThrow(
      TemplateConfigValidationError,
    );
  });

  it("rejects an empty cover text", () => {
    expect(() => validateTemplateConfigInput({ ...validInput, coverText: "" })).toThrow(
      TemplateConfigValidationError,
    );
  });

  it("rejects cover text over the max length", () => {
    expect(() => validateTemplateConfigInput({ ...validInput, coverText: "a".repeat(301) })).toThrow(
      TemplateConfigValidationError,
    );
  });

  it("collects all field errors on the thrown error, not just the first", () => {
    try {
      validateTemplateConfigInput({});
      expect.fail("expected validation to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateConfigValidationError);
      const validationError = err as TemplateConfigValidationError;
      expect(Object.keys(validationError.errors).sort()).toEqual(
        ["coverText", "font", "logoUrl", "primaryColor", "secondaryColor"].sort(),
      );
    }
  });
});

describe("selectedTemplateId validation (R8.1/R8.4 — additive, unwired until WU3)", () => {
  it("accepts a selectedTemplateId alongside the still-required legacy branding fields", () => {
    const result = validateTemplateConfigInput({ ...validInput, selectedTemplateId: "dforce-classic" });
    expect(result.selectedTemplateId).toBe("dforce-classic");
  });

  it("defaults to null when omitted", () => {
    const result = validateTemplateConfigInput(validInput);
    expect(result.selectedTemplateId).toBeNull();
  });

  it("defaults to null when not a string", () => {
    const result = validateTemplateConfigInput({ ...validInput, selectedTemplateId: 42 });
    expect(result.selectedTemplateId).toBeNull();
  });

  it("defaults to null for an id not in the registry, instead of persisting it verbatim", () => {
    const result = validateTemplateConfigInput({ ...validInput, selectedTemplateId: "not-a-real-template" });
    expect(result.selectedTemplateId).toBeNull();
  });

  it("still rejects a missing logoUrl even when selectedTemplateId is present (columns are NOT NULL until migration 0009)", () => {
    expect(() =>
      validateTemplateConfigInput({ ...validInput, selectedTemplateId: "dforce-classic", logoUrl: "" }),
    ).toThrow(TemplateConfigValidationError);
  });
});

describe("defaultImageHandling validation", () => {
  it("accepts strict", () => {
    const result = validateTemplateConfigInput({ ...validInput, defaultImageHandling: "strict" });
    expect(result.defaultImageHandling).toBe("strict");
  });

  it("accepts adaptive", () => {
    const result = validateTemplateConfigInput({ ...validInput, defaultImageHandling: "adaptive" });
    expect(result.defaultImageHandling).toBe("adaptive");
  });

  it("defaults to null when omitted (backward compat)", () => {
    const result = validateTemplateConfigInput(validInput);
    expect(result.defaultImageHandling).toBeNull();
  });

  it("defaults to null when value is invalid", () => {
    const result = validateTemplateConfigInput({ ...validInput, defaultImageHandling: "invalid" });
    expect(result.defaultImageHandling).toBeNull();
  });
});

describe("selectedTemplateId persistence (R8.4 — selection survives a restart)", () => {
  it("round-trips a saved selectedTemplateId through getTemplateConfig", async () => {
    let row: Record<string, unknown> | undefined;
    const fakeDb = {
      insert: () => ({
        values: (values: Record<string, unknown>) => ({
          onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => ({
            returning: async () => {
              row = { ...values, ...set };
              return [row];
            },
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => (row ? [row] : []),
          }),
        }),
      }),
    };

    await saveTemplateConfig({ ...validInput, selectedTemplateId: "dforce-classic" }, fakeDb as never);
    const result = await getTemplateConfig(fakeDb as never);

    expect(result?.selectedTemplateId).toBe("dforce-classic");
  });
});
