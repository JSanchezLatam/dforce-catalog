import { describe, expect, it } from "vitest";

import { ESTILO_OPTIONS, MONTH_NAMES, MOTOR_LABEL, MOTOR_VALUES } from "./vehicle-options";

describe("vehicle options", () => {
  it("carries the estilo list the owner approved", () => {
    expect([...ESTILO_OPTIONS]).toEqual(["Sedán", "Hatchback", "SUV", "Pick-up", "Van/Panel", "Coupé", "Moto", "Otro"]);
  });

  it("labels every motor value in Spanish", () => {
    expect(MOTOR_VALUES.map((m) => MOTOR_LABEL[m])).toEqual(["Combustión", "Eléctrico", "Híbrido"]);
  });

  it("has twelve month names, January first and December last", () => {
    expect(MONTH_NAMES).toHaveLength(12);
    expect(MONTH_NAMES[0]).toBe("enero");
    expect(MONTH_NAMES[11]).toBe("diciembre");
  });
});
