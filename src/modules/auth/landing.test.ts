import { describe, expect, it } from "vitest";

import { landingPathFor } from "./landing";
import { ROLES } from "./roles";

describe("Landing per role — landingPathFor()", () => {
  it.each(ROLES)("%s lands where its role belongs", (role) => {
    expect(landingPathFor(role)).toBe(role === "pantalla" ? "/tablero/clientes" : "/inventory");
  });
});
