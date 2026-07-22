import { describe, expect, it } from "vitest";

import { TemplateConfigValidationError, validateTemplateConfigInput } from "./service";

const validInput = {
  logoUrl: "https://example.com/logo.png",
  primaryColors: { primary: "#112233", secondary: "#445566" },
  font: "Arial, sans-serif",
  coverText: "Dforce Car — Catalogo 2026",
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
