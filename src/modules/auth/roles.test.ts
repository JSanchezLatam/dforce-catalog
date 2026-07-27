import { describe, expect, it } from "vitest";

import { isRole, type Role } from "./roles";

const ALL_ROLES: Role[] = ["tecnico", "administrador"];

describe("isRole()", () => {
  it("tecnico is a valid role", () => {
    expect(isRole("tecnico")).toBe(true);
  });

  it("administrador is a valid role", () => {
    expect(isRole("administrador")).toBe(true);
  });

  it("usuario is NOT a valid role (renamed to tecnico)", () => {
    expect(isRole("usuario")).toBe(false);
  });

  it("empty string is not a valid role", () => {
    expect(isRole("")).toBe(false);
  });

  it("undefined is not a valid role", () => {
    expect(isRole(undefined)).toBe(false);
  });

  it("random string is not a valid role", () => {
    expect(isRole("ghost")).toBe(false);
  });

  it("null is not a valid role", () => {
    expect(isRole(null)).toBe(false);
  });

  it("every value in ALL_ROLES returns true", () => {
    for (const r of ALL_ROLES) {
      expect(isRole(r)).toBe(true);
    }
  });
});
