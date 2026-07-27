import { describe, expect, it } from "vitest";

import { ClienteValidationError, isValidPhoneFormat, normalizePhone, validateClienteInput } from "./validation";

const validInput = {
  name: "Juan Pérez",
  phone: "+52 55 1234 5678",
};

describe("validateClienteInput (R17)", () => {
  it("accepts a minimal valid input (name + phone only) and normalizes the phone", () => {
    const result = validateClienteInput(validInput);
    expect(result.name).toBe("Juan Pérez");
    expect(result.phone).toBe("+525512345678");
  });

  it("rejects a missing name", () => {
    expect(() => validateClienteInput({ ...validInput, name: "" })).toThrow(ClienteValidationError);
  });

  it("rejects a missing phone", () => {
    expect(() => validateClienteInput({ ...validInput, phone: "" })).toThrow(ClienteValidationError);
  });

  it("rejects an invalid phone format", () => {
    expect(() => validateClienteInput({ ...validInput, phone: "abc123" })).toThrow(ClienteValidationError);
  });

  it("rejects an invalid email format when email is provided", () => {
    expect(() => validateClienteInput({ ...validInput, email: "not-an-email" })).toThrow(ClienteValidationError);
  });

  it("accepts a submission with no vehicle fields at all (vehicle is optional)", () => {
    expect(() => validateClienteInput(validInput)).not.toThrow();
  });

  it("rejects a vehicle make with no plate", () => {
    expect(() => validateClienteInput({ ...validInput, vehicleMake: "Toyota" })).toThrow(ClienteValidationError);
  });

  it("accepts a vehicle make when a plate is also given", () => {
    expect(() =>
      validateClienteInput({ ...validInput, vehicleMake: "Toyota", vehiclePlate: "ABC-123" }),
    ).not.toThrow();
  });

  it("collects all field errors on the thrown error, not just the first", () => {
    try {
      validateClienteInput({});
      expect.fail("expected validation to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ClienteValidationError);
      const validationError = err as ClienteValidationError;
      expect(Object.keys(validationError.errors).sort()).toEqual(["name", "phone"]);
    }
  });
});

describe("isValidPhoneFormat (R17)", () => {
  it("accepts a plain digit-only phone within 7-15 digits", () => {
    expect(isValidPhoneFormat("5512345678")).toBe(true);
  });

  it("accepts a phone with a leading + and separators", () => {
    expect(isValidPhoneFormat("+52 55-1234 5678")).toBe(true);
  });

  it("rejects letters", () => {
    expect(isValidPhoneFormat("abc123")).toBe(false);
  });

  it("rejects fewer than 7 digits", () => {
    expect(isValidPhoneFormat("123456")).toBe(false);
  });

  it("rejects more than 15 digits", () => {
    expect(isValidPhoneFormat("1234567890123456")).toBe(false);
  });
});

describe("normalizePhone (E.164-ish, needed for Kapso in Phase 7)", () => {
  it("strips separators but keeps digits when there is no leading +", () => {
    expect(normalizePhone("55 1234 5678")).toBe("5512345678");
  });

  it("keeps a leading + and strips other separators", () => {
    expect(normalizePhone("+52 (55) 1234-5678")).toBe("+525512345678");
  });
});
