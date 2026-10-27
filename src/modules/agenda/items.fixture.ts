import type { AgendaItem, WorkshopItem } from "./items";

export function makeItem(over: Partial<AgendaItem> = {}): AgendaItem {
  return {
    id: "o1",
    href: `/service-orders/${over.id ?? "o1"}`,
    dayKey: "2026-10-26",
    time: "14:05",
    customerName: "Pérez",
    customerPhone: "61234567",
    vehicleLabel: "AB1234",
    status: "booked",
    statusLabel: "Agendada",
    muted: false,
    overdue: false,
    ...over,
  };
}

export function makeWorkshopItem(over: Partial<WorkshopItem> = {}): WorkshopItem {
  return {
    id: "w1",
    href: `/service-orders/${over.id ?? "w1"}`,
    customerName: "Pérez",
    customerPhone: "61234567",
    vehicleLabel: "AB1234",
    status: "in_progress",
    statusLabel: "En progreso",
    holdReason: null,
    ...over,
  };
}
