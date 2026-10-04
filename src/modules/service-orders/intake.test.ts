import { describe, expect, it } from "vitest";

import { FUEL_LABEL, intakeInputsFor, parseIntake } from "./intake";

describe("parseIntake — kilometraje, nivelCombustible, bateriaPct", () => {
  it("accepts valid values and returns them as numbers", () => {
    expect(parseIntake({ kilometraje: 85000, nivelCombustible: 2, bateriaPct: 100 })).toEqual({
      ok: true,
      value: { kilometraje: 85000, nivelCombustible: 2, bateriaPct: 100 },
    });
  });

  it("accepts the range edges", () => {
    expect(parseIntake({ kilometraje: 0, nivelCombustible: 0, bateriaPct: 0 })).toEqual({
      ok: true,
      value: { kilometraje: 0, nivelCombustible: 0, bateriaPct: 0 },
    });
    expect(parseIntake({ kilometraje: 2_000_000, nivelCombustible: 4, bateriaPct: 100 }).ok).toBe(true);
  });

  it("keeps null as null (an explicit clear) and omits what was not sent", () => {
    expect(parseIntake({ kilometraje: null })).toEqual({ ok: true, value: { kilometraje: null } });
    expect(parseIntake({})).toEqual({ ok: true, value: {} });
  });

  it.each([-1, 1.5, "abc", "85000", true, 2_000_001, Number.NaN])("rejects kilometraje %j", (km) => {
    expect(parseIntake({ kilometraje: km })).toEqual({
      ok: false,
      errors: { kilometraje: "El kilometraje tiene que ser un número entero entre 0 y 2.000.000" },
    });
  });

  it.each([5, -1, 1.5, "2"])("rejects nivelCombustible %j", (fuel) => {
    expect(parseIntake({ nivelCombustible: fuel })).toEqual({
      ok: false,
      errors: { nivelCombustible: "El nivel de combustible tiene que ser un valor entre 0 y 4" },
    });
  });

  it.each([101, -1, 0.5, "80"])("rejects bateriaPct %j", (battery) => {
    expect(parseIntake({ bateriaPct: battery })).toEqual({
      ok: false,
      errors: { bateriaPct: "La batería tiene que ser un número entero entre 0 y 100" },
    });
  });

  it("reports every bad key at once", () => {
    const result = parseIntake({ kilometraje: -1, nivelCombustible: 9, bateriaPct: 101 });
    expect(result.ok).toBe(false);
    expect(Object.keys(!result.ok ? result.errors : {}).sort()).toEqual([
      "bateriaPct",
      "kilometraje",
      "nivelCombustible",
    ]);
  });
});

describe("intakeInputsFor — which inputs the vehicle's motor shows", () => {
  it.each([
    ["combustion", { fuel: true, battery: false }],
    ["electrico", { fuel: false, battery: true }],
    ["hibrido", { fuel: true, battery: true }],
    [null, { fuel: true, battery: true }],
  ] as const)("%s", (motor, expected) => {
    expect(intakeInputsFor(motor)).toEqual(expected);
  });
});

describe("FUEL_LABEL", () => {
  it("names the five quarter-tank steps", () => {
    expect(FUEL_LABEL).toEqual(["Vacío", "1/4", "1/2", "3/4", "Lleno"]);
  });
});
