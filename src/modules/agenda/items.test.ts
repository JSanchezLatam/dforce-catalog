import { describe, expect, it } from "vitest";

import { groupByDay, nextLabel, toAgendaItem, toWeekSummary, toWorkshopItem, type AgendaItem } from "./items";
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
    vehicleMake: "Toyota",
    vehicleModel: "Corolla",
    vehicleYear: 2019,
    categoria: "revisado",
    description: null,
    noShow: false,
    technicians: [],
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
      minuteOfDay: 14 * 60 + 5,
      vehicleLabel: "AB1234 · Toyota Corolla",
      vehicleDetail: "AB1234 · Toyota Corolla 2019",
      categoria: "revisado",
      categoriaLabel: "REVISADO",
      description: null,
      technicians: [],
      status: "booked",
      statusLabel: "Agendada",
      muted: false,
      overdue: false,
      noShow: false,
    });
  });

  it("Card fields: the description is on the item (the Detail shows it, the card hides it)", () => {
    expect(toAgendaItem(row({ description: "Cambio de aceite" }), NOW).description).toBe("Cambio de aceite");
  });

  it("Card fields: no Date and no function anywhere in the item, so it crosses the Server Component boundary", () => {
    const item = toAgendaItem(row({ technicians: [{ id: "t1", nombre: "Julio Rangel" }] }), NOW);
    const walk = (v: unknown): void => {
      expect(v instanceof Date).toBe(false);
      expect(typeof v).not.toBe("function");
      if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(item);
    expect(JSON.parse(JSON.stringify(item))).toEqual(item);
  });

  it("Technician initials: the first letters of the first two words, upper-case", () => {
    const item = toAgendaItem(
      row({
        technicians: [
          { id: "t1", nombre: "Julio Rangel" },
          { id: "t2", nombre: "marta" },
          { id: "t3", nombre: "Ana María de la Cruz" },
        ],
      }),
      NOW,
    );
    expect(item.technicians).toEqual([
      { id: "t1", nombre: "Julio Rangel", initials: "JR" },
      { id: "t2", nombre: "marta", initials: "M" },
      { id: "t3", nombre: "Ana María de la Cruz", initials: "AM" },
    ]);
  });

  it("No vehicle, no type: placeholders instead of nulls", () => {
    const item = toAgendaItem(row({ vehiclePlate: null, vehicleMake: null, vehicleModel: null, vehicleYear: null, categoria: null }), NOW);
    expect(item.vehicleLabel).toBe("Sin vehículo");
    expect(item.vehicleDetail).toBe("Sin vehículo");
    expect(item.categoria).toBeNull();
    expect(item.categoriaLabel).toBe("Sin categoría");
  });

  it("a plate with no make or model is the plate alone, never a dangling separator", () => {
    const item = toAgendaItem(row({ vehicleMake: null, vehicleModel: null, vehicleYear: null }), NOW);
    expect(item.vehicleLabel).toBe("AB1234");
    expect(item.vehicleDetail).toBe("AB1234");
  });

  it("Status is text as well as colour: a no-show says 'No se presentó' and is muted", () => {
    const item = toAgendaItem(row({ status: "cancelled", noShow: true }), NOW);
    expect(item.noShow).toBe(true);
    expect(item.statusLabel).toBe("No se presentó");
    expect(item.muted).toBe(true);
    expect(item.overdue).toBe(false);
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
    expect(toAgendaItem(row({ vehiclePlate: null, vehicleMake: null, vehicleModel: null }), NOW).vehicleLabel).toBe("Sin vehículo");
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

describe("nextLabel", () => {
  const at = (iso: string) => new Date(iso);
  const now = at("2026-10-27T15:40:00Z"); // 10:40 Panama

  it("Próxima cita text: minutes under an hour, hours and minutes under a day, digits after", () => {
    expect(nextLabel(at("2026-10-27T16:00:00Z"), now)).toBe("en 20 min");
    expect(nextLabel(at("2026-10-27T16:40:00Z"), now)).toBe("en 1 h");
    expect(nextLabel(at("2026-10-27T17:00:00Z"), now)).toBe("en 1 h 20 min");
    expect(nextLabel(at("2026-10-28T15:39:00Z"), now)).toBe("en 23 h 59 min");
    expect(nextLabel(at("2026-10-28T15:40:00Z"), now)).toBe("28/10/2026");
  });

  it("the later date is the PANAMA day: 23:30 Panama is already the next UTC day", () => {
    expect(nextLabel(at("2026-11-03T04:30:00Z"), now)).toBe("02/11/2026");
  });
});

describe("toWeekSummary", () => {
  it("lists the four counts in the order the column shows them, as plain data", () => {
    const summary = toWeekSummary({ agendadas: 5, recibidas: 3, vencidas: 2, noShow: 1 });
    expect(summary).toEqual([
      { label: "Agendadas", count: 5 },
      { label: "Recibidas", count: 3 },
      { label: "Vencidas", count: 2 },
      { label: "No se presentó", count: 1 },
    ]);
  });
});
