import { describe, expect, it } from "vitest";

import { cardAlert } from "./alerts";
import type { BoardRow } from "./shape";

const NOW = "2026-10-27T15:00:00.000Z";
const MIN = 60_000;
const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();

const row = (over: Partial<BoardRow>): BoardRow => ({
  status: "in_progress",
  statusLabel: "En progreso",
  plate: "AB1234",
  make: "Toyota",
  model: "Hilux",
  holdReason: null,
  technicians: [],
  statusSince: ago(5 * 60 * MIN),
  urgent: false,
  ...over,
});

describe("Card Content and Color Rules - cardAlert(): amber only for a concrete reason", () => {
  it("a long-running in_progress card with nothing missing has no alert", () => {
    expect(cardAlert(row({ statusSince: ago(10 * 24 * 60 * MIN) }), NOW, [])).toBeNull();
  });

  it("an urgent card is not an alert reason (red is the badge's job)", () => {
    expect(cardAlert(row({ urgent: true }), NOW)).toBeNull();
  });

  it.each([
    [70 * MIN, "Cita vencida · hace 1 h 10 min"],
    [3 * 60 * MIN, "Cita vencida · hace 3 h"],
    [25 * MIN, "Cita vencida · hace 25 min"],
    [24 * 60 * MIN, "Cita vencida · hace 1 día"],
    [3 * 24 * 60 * MIN + 5 * 60 * MIN, "Cita vencida · hace 3 días"],
  ])("a booked appointment %i ms in the past reads %s", (elapsed, text) => {
    expect(cardAlert(row({ status: "booked", appointmentAt: ago(elapsed) }), NOW)).toEqual({ kind: "overdue", text });
  });

  it("a booked appointment still ahead has no alert", () => {
    expect(cardAlert(row({ status: "booked", appointmentAt: ago(-30 * MIN) }), NOW)).toBeNull();
  });

  it("a booked order with no appointment time has no alert", () => {
    expect(cardAlert(row({ status: "booked", appointmentAt: null }), NOW)).toBeNull();
  });

  it("an appointment in the past on a non-booked order is not overdue", () => {
    expect(cardAlert(row({ status: "open", appointmentAt: ago(70 * MIN) }), NOW)).toBeNull();
  });

  it("an on_hold card reads '<motivo> · hace <tiempo en estado>'", () => {
    const held = row({ status: "on_hold", holdReason: "Repuesto", statusSince: ago(3 * 24 * 60 * MIN) });
    expect(cardAlert(held, NOW)).toEqual({ kind: "hold", text: "Repuesto · hace 3 días" });
    expect(cardAlert(row({ status: "on_hold", holdReason: "Aprobación del cliente", statusSince: ago(6 * 60 * MIN) }), NOW)).toEqual({
      kind: "hold",
      text: "Aprobación del cliente · hace 6 h",
    });
  });

  it("an on_hold card with no reason still shows its age", () => {
    expect(cardAlert(row({ status: "on_hold", holdReason: null, statusSince: ago(20 * MIN) }), NOW)).toEqual({
      kind: "hold",
      text: "En espera · hace 20 min",
    });
  });

  it.each([
    [["vehiculo", "categoria"] as const, "Falta vehículo y categoría"],
    [["vehiculo"] as const, "Falta vehículo"],
    [["categoria"] as const, "Falta categoría"],
  ])("missing %j reads %s", (missing, text) => {
    expect(cardAlert(row({ status: "booked", appointmentAt: ago(-60 * MIN) }), NOW, [...missing])).toEqual({ kind: "missing", text });
  });

  it("the TV boards pass no `missing`, so they never show a missing-data alert", () => {
    expect(cardAlert(row({ status: "booked", appointmentAt: ago(-60 * MIN) }), NOW)).toBeNull();
  });

  it("missing data wins over an overdue appointment (it blocks reception)", () => {
    expect(cardAlert(row({ status: "booked", appointmentAt: ago(70 * MIN) }), NOW, ["categoria"])?.kind).toBe("missing");
  });
});
