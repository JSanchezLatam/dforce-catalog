import { describe, expect, it } from "vitest";

import { CATEGORY_LABELS, ROLE_LABELS, STATUS_LABELS, formatPanama, isDelayed } from "./format";

const at = (iso: string) => new Date(iso);

describe("isDelayed: strictly more than 10 minutes between written and received", () => {
  const created = at("2026-11-09T14:00:00Z");
  it("is not late at exactly 10:00", () => {
    expect(isDelayed(created, at("2026-11-09T14:10:00Z"))).toBe(false);
  });
  it("is late one second over (10:01)", () => {
    expect(isDelayed(created, at("2026-11-09T14:10:01Z"))).toBe(true);
  });
  it("is not late when delivered at the same instant", () => {
    expect(isDelayed(created, created)).toBe(false);
  });
  it("is late for a comment queued for hours", () => {
    expect(isDelayed(at("2026-11-09T14:12:00Z"), at("2026-11-09T19:47:00Z"))).toBe(true);
  });
});

describe("formatPanama: dd/MM/yyyy HH:mm in America/Panama (UTC-5, no DST)", () => {
  it("shifts UTC to Panama time", () => {
    expect(formatPanama(at("2026-11-09T14:12:00Z"))).toBe("09/11/2026 09:12");
  });
  it("rolls the date back across midnight and pads with zeros", () => {
    expect(formatPanama(at("2026-11-09T03:05:00Z"))).toBe("08/11/2026 22:05");
  });
  it("writes midnight as 00:00, never 24:00", () => {
    expect(formatPanama(at("2026-11-09T05:00:00Z"))).toBe("09/11/2026 00:00");
  });
});

describe("labels", () => {
  it("use the mockup copy", () => {
    expect(STATUS_LABELS).toEqual({ nuevo: "Nuevo", leido: "Leído", resuelto: "Resuelto" });
    expect(CATEGORY_LABELS).toEqual({ bug: "Algo no funciona", idea: "Idea o mejora", other: "Otra cosa" });
    expect(ROLE_LABELS).toEqual({ tecnico: "Técnico", jefe_taller: "Jefe de taller", administrador: "Administrador" });
  });
});
