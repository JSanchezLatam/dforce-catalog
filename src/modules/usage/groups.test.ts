import { describe, expect, it } from "vitest";

import { ROLES } from "@/modules/auth/roles";
import { roleGroupOf } from "./groups";

describe("roleGroupOf", () => {
  it.each([
    ["administrador", "gestion"],
    ["jefe_taller", "gestion"],
    ["tecnico", "tecnico"],
  ] as const)("%s counts as %s", (role, group) => {
    expect(roleGroupOf(role)).toBe(group);
  });

  it("pantalla is not countable", () => {
    expect(roleGroupOf("pantalla")).toBeNull();
  });

  it("every role is decided: only pantalla is refused", () => {
    expect(ROLES.filter((r) => roleGroupOf(r) === null)).toEqual(["pantalla"]);
  });
});
