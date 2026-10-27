import type { AgendaItem } from "./items";

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
