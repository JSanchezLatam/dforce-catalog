import { describe, expect, it } from "vitest";

import { MIN_PASSWORD_LENGTH } from "./password-policy";
import { passwordPolicyError } from "./password-rules";

describe("passwordPolicyError", () => {
  it("requires at least 10 characters", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(passwordPolicyError("corta-123")).toBe("La contraseña debe tener al menos 10 caracteres.");
  });

  it("accepts an uncommon password of exactly 10 characters", () => {
    expect(passwordPolicyError("taller-k7q")).toBeNull();
  });

  it.each(["1234567890", "password123", "contraseña1", "qwertyuiop", "admin12345"])(
    "rejects the common password %s",
    (password) => {
      expect(passwordPolicyError(password)).toBe("Es demasiado común. Elegí otra.");
    },
  );

  it("ignores letter case when matching the common list", () => {
    expect(passwordPolicyError("PassWord123")).toBe("Es demasiado común. Elegí otra.");
  });

  it.each([" password123 ", "contrasen\u0303a123", "aaaaaaaaaa", "2222222222"])(
    "normalizes before matching and rejects a repeated character: %j",
    (password) => {
      expect(passwordPolicyError(password)).toBe("Es demasiado común. Elegí otra.");
    },
  );

  it.each(["123456    ", "  qwerty  ", "password  ", "          "])(
    "does not count surrounding spaces toward the minimum: %j",
    (password) => {
      expect(passwordPolicyError(password)).toBe("La contraseña debe tener al menos 10 caracteres.");
    },
  );

  it("rejects a value that is not text", () => {
    expect(passwordPolicyError(undefined)).toBe("La contraseña debe tener al menos 10 caracteres.");
  });
});
