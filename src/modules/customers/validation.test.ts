import { describe, expect, it } from "vitest";

import {
  ClienteValidationError,
  isValidPhoneFormat,
  normalizePhone,
  validateClienteInput,
  validateVehiculoInput,
  validateVehiculosInput,
} from "./validation";

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

  /**
   * Migration `0014` (slice 3) drops `cliente`'s four inline vehicle columns
   * — `ClienteInput` no longer carries them, and `validateClienteInput` no
   * longer reads them at all. Per-vehicle validation lives entirely in
   * `validateVehiculoInput`/`validateVehiculosInput` now (D6).
   */
  it("ignores flat vehicle-shaped fields entirely — the flat write path was removed", () => {
    const result = validateClienteInput({ ...validInput, vehicleMake: "Toyota", vehiclePlate: "ABC-123" });
    expect(result).not.toHaveProperty("vehicleMake");
    expect(result).not.toHaveProperty("vehiclePlate");
  });

  it("no longer rejects a lone vehicleMake with no plate — that guard moved to validateVehiculoInput (D6)", () => {
    expect(() => validateClienteInput({ ...validInput, vehicleMake: "Toyota" })).not.toThrow();
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

describe("validateVehiculoInput (R17 relocated, D6)", () => {
  it("accepts a vehicle with only a plate (make/model/year optional)", () => {
    expect(validateVehiculoInput({ plate: "ABC-123" })).toEqual({ plate: "ABC-123" });
  });

  it("rejects a vehicle with make but no plate", () => {
    expect(() => validateVehiculoInput({ make: "Toyota" })).toThrow(ClienteValidationError);
  });

  it("accepts a fully-populated vehicle and normalizes fields", () => {
    expect(validateVehiculoInput({ plate: "ABC-123", make: "Toyota", model: "Corolla", year: 2020 })).toEqual({
      plate: "ABC-123",
      make: "Toyota",
      model: "Corolla",
      year: 2020,
    });
  });

  it("preserves a supplied id (identifies an update, never a key by plate)", () => {
    expect(validateVehiculoInput({ id: "v1", plate: "ABC-123" })).toEqual({ id: "v1", plate: "ABC-123" });
  });

  /**
   * The activation state a client asks for. Absent means "leave it as it is",
   * which is what makes an unchanged round trip a no-op — so it must NOT be
   * defaulted to `false` here.
   */
  it("passes an explicit activation state through, and omits it entirely when the payload is silent", () => {
    expect(validateVehiculoInput({ plate: "ABC-123", deactivated: false })).toEqual({
      plate: "ABC-123",
      deactivated: false,
    });
    expect(validateVehiculoInput({ plate: "ABC-123" })).not.toHaveProperty("deactivated");
    expect(validateVehiculoInput({ plate: "ABC-123", deactivated: "yes" })).not.toHaveProperty("deactivated");
  });
});

describe("validateVehiculosInput (per-vehicle, independent)", () => {
  it("returns undefined when the vehicles key is omitted (collection untouched)", () => {
    expect(validateVehiculosInput(undefined)).toBeUndefined();
  });

  it("returns an empty array for an explicit empty list", () => {
    expect(validateVehiculosInput([])).toEqual([]);
  });

  it("validates every vehicle independently — one invalid sibling never changes a valid one's fields", () => {
    expect(() =>
      validateVehiculosInput([{ plate: "ABC-123" }, { make: "Toyota" }]),
    ).toThrow(ClienteValidationError);

    try {
      validateVehiculosInput([{ plate: "ABC-123" }, { make: "Toyota" }]);
      expect.fail("expected validation to throw");
    } catch (err) {
      const validationError = err as ClienteValidationError;
      // Only the invalid (second, index 1) vehicle is cited.
      expect(Object.keys(validationError.errors)).toEqual(["vehicles.1.plate"]);
    }
  });

  it("rejects a non-array vehicles payload", () => {
    expect(() => validateVehiculosInput("not-an-array")).toThrow(ClienteValidationError);
  });
});

describe("validateVehiculoInput — permanent delete", () => {
  it("passes a boolean `deleted` through and ignores a non-boolean one", () => {
    expect(validateVehiculoInput({ id: "v1", plate: "ABC-123", deleted: true })).toMatchObject({ deleted: true });
    expect(validateVehiculoInput({ id: "v1", plate: "ABC-123" })).not.toHaveProperty("deleted");
    expect(validateVehiculoInput({ id: "v1", plate: "ABC-123", deleted: "si" })).not.toHaveProperty("deleted");
  });

  /**
   * A delete addresses a row by id; its other columns are about to stop
   * existing. Requiring a plate here would mean a staff member who blanked the
   * plate field and THEN asked to remove the row got "La placa es obligatoria"
   * for a card no longer on screen.
   */
  it("does not require a plate on a delete, but still does on every other element", () => {
    expect(validateVehiculoInput({ id: "v1", deleted: true })).toEqual({ id: "v1", plate: "", deleted: true });
    expect(() => validateVehiculoInput({ id: "v1", deleted: false })).toThrow(ClienteValidationError);
  });
});
