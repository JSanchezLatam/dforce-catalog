import { describe, expect, it } from "vitest";

import { describeDue } from "./display";

const TODAY = "2026-10-04";

describe("describeDue()", () => {
  it("an overdue insurance reads 'venció' with the dd/mm/aaaa date and the destructive chip", () => {
    expect(describeDue({ kind: "seguro", periodKey: "2026-09-28", state: "overdue", daysLeft: -6 }, TODAY)).toEqual({
      when: "Seguro — venció 28/09/2026",
      chipLabel: "Vencido",
      chipStatus: "failed",
    });
  });

  it("a due insurance reads 'vence' and counts the days, singular at one and 'Hoy' at zero", () => {
    expect(describeDue({ kind: "seguro", periodKey: "2026-10-16", state: "due", daysLeft: 12 }, TODAY)).toEqual({
      when: "Seguro — vence 16/10/2026",
      chipLabel: "En 12 días",
      chipStatus: "in_progress",
    });
    expect(describeDue({ kind: "seguro", periodKey: "2026-10-05", state: "due", daysLeft: 1 }, TODAY).chipLabel).toBe("En 1 día");
    expect(describeDue({ kind: "seguro", periodKey: "2026-10-04", state: "due", daysLeft: 0 }, TODAY).chipLabel).toBe("Hoy");
  });

  it("a plate in the current month is 'Este mes', in the next 'Próximo mes' (grey), overdue 'Vencido'", () => {
    expect(describeDue({ kind: "placa", periodKey: "2026-10", state: "due", daysLeft: null }, TODAY)).toEqual({
      when: "Placa — octubre",
      chipLabel: "Este mes",
      chipStatus: "in_progress",
    });
    expect(describeDue({ kind: "placa", periodKey: "2026-11", state: "due", daysLeft: null }, TODAY)).toEqual({
      when: "Placa — noviembre",
      chipLabel: "Próximo mes",
      chipStatus: "pending",
    });
    expect(describeDue({ kind: "placa", periodKey: "2026-09", state: "overdue", daysLeft: null }, TODAY)).toEqual({
      when: "Placa — septiembre",
      chipLabel: "Vencido",
      chipStatus: "failed",
    });
  });

  it("December wraps: in December a January plate is 'Próximo mes'", () => {
    expect(describeDue({ kind: "placa", periodKey: "2027-01", state: "due", daysLeft: null }, "2026-12-20").chipLabel).toBe("Próximo mes");
  });
});
