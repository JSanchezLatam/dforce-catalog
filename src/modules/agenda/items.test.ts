import { describe, expect, it } from "vitest";

import { groupByDay, toAgendaItem, toWorkshopItem, type AgendaItem } from "./items";
import type { AgendaRow, WorkshopRow } from "./queries";

const NOW = new Date("2026-10-26T20:00:00Z"); // 15:00 Panama

function row(over: Partial<AgendaRow> = {}): AgendaRow {
  return {
    id: "o1",
    status: "booked",
    appointmentAt: new Date("2026-10-26T19:05:00Z"), // 14:05 Panama
    customerName: "Pérez",
    customerPhone: "61234567",
    vehiclePlate: "AB1234",
    ...over,
  };
}

describe("toAgendaItem", () => {
  it("Chip fields: plain strings for the Panama day, time, label and status", () => {
    const item = toAgendaItem(row(), NOW);
    expect(item).toEqual({
      id: "o1",
      href: "/service-orders/o1",
      dayKey: "2026-10-26",
      time: "14:05",
      customerName: "Pérez",
      customerPhone: "61234567",
      vehicleLabel: "AB1234",
      status: "booked",
      statusLabel: "Agendada",
      muted: false,
      overdue: false,
    });
    expect(Object.keys(item)).not.toContain("description");
  });

  it("Flag is a server-computed boolean: the item survives a JSON round trip unchanged", () => {
    const item = toAgendaItem(row({ appointmentAt: new Date("2026-10-26T15:00:00Z") }), NOW);
    expect(typeof item.overdue).toBe("boolean");
    expect(item.overdue).toBe(true);
    expect(JSON.parse(JSON.stringify(item))).toEqual(item);
  });

  it("the Panama day, not the UTC day: 23:30 Panama is already the next UTC day", () => {
    const item = toAgendaItem(row({ appointmentAt: new Date("2026-10-27T04:30:00Z") }), NOW);
    expect(item.dayKey).toBe("2026-10-26");
    expect(item.time).toBe("23:30");
  });

  it("Booked order without a vehicle: 'Sin vehículo'", () => {
    expect(toAgendaItem(row({ vehiclePlate: null }), NOW).vehicleLabel).toBe("Sin vehículo");
  });

  it("Only booked orders are Vencida: an open order three hours late is muted, not overdue", () => {
    const item = toAgendaItem(row({ status: "open", appointmentAt: new Date("2026-10-26T17:00:00Z") }), NOW);
    expect(item.muted).toBe(true);
    expect(item.overdue).toBe(false);
    expect(item.statusLabel).toBe("Recibida");
  });

  it("refuses a row without an appointment instead of inventing a time", () => {
    expect(() => toAgendaItem(row({ appointmentAt: null }), NOW)).toThrow();
  });
});

describe("groupByDay", () => {
  const item = (id: string, dayKey: string, time: string) => ({ id, dayKey, time }) as AgendaItem;

  it("Overlap stacks: orders by time, then id, inside each day", () => {
    const grouped = groupByDay([item("c", "d1", "09:00"), item("a", "d1", "09:00"), item("z", "d1", "08:00"), item("b", "d2", "07:00")]);
    expect(grouped.get("d1")!.map((i) => i.id)).toEqual(["z", "a", "c"]);
    expect(grouped.get("d2")!.map((i) => i.id)).toEqual(["b"]);
  });
});

describe("toWorkshopItem", () => {
  const wrow = (over: Partial<WorkshopRow> = {}): WorkshopRow => ({
    id: "w1",
    status: "in_progress",
    esperaMotivo: null,
    customerName: "Pérez",
    customerPhone: "61234567",
    vehiclePlate: "AB1234",
    ...over,
  });

  it("Hold reason shown only while on hold: the label for on_hold, none for in_progress", () => {
    expect(toWorkshopItem(wrow({ status: "on_hold", esperaMotivo: "repuesto" })).holdReason).toBe("Repuesto");
    expect(toWorkshopItem(wrow({ status: "in_progress", esperaMotivo: "repuesto" })).holdReason).toBeNull();
  });

  it("is plain data: label, link, 'Sin vehículo' for a null plate, survives a JSON round trip", () => {
    const item = toWorkshopItem(wrow({ status: "open", vehiclePlate: null }));
    expect(item).toEqual({
      id: "w1",
      href: "/service-orders/w1",
      customerName: "Pérez",
      customerPhone: "61234567",
      vehicleLabel: "Sin vehículo",
      status: "open",
      statusLabel: "Recibida",
      holdReason: null,
    });
    expect(JSON.parse(JSON.stringify(item))).toEqual(item);
  });
});
