/**
 * agenda/items.ts - one query row to the plain data the views render. Plain JSON values only:
 * no `Date` and no function crosses a Server Component boundary, and `overdue` is decided here, on the server, from
 * the one `now` the page captured (the client never sees a clock).
 */
import { formatAgendaTime, isOverdue, panamaDay } from "@/modules/agenda/dates";
import type { AgendaRow, WeekCounts, WorkshopRow } from "@/modules/agenda/queries";
import { categoriaLabel, type ServiceCategory } from "@/modules/service-orders/categories";
import { ESPERA_MOTIVO_LABEL, ORDER_STATUS_LABEL } from "@/modules/service-orders/statuses";

export type AgendaItem = {
  id: string;
  href: string;
  /** Panama day, `YYYY-MM-DD`. */
  dayKey: string;
  /** Panama time, `HH:mm`. */
  time: string;
  customerName: string;
  customerPhone: string;
  /** Minutes since Panama midnight; the grid places the card from it. */
  minuteOfDay: number;
  /** `plate · make model`, the plate alone, or "Sin vehículo". */
  vehicleLabel: string;
  /** `vehicleLabel` plus the year when there is one. */
  vehicleDetail: string;
  categoria: ServiceCategory | null;
  categoriaLabel: string;
  description: string | null;
  technicians: { id: string; nombre: string; initials: string }[];
  status: AgendaRow["status"];
  statusLabel: string;
  /** Any status but `booked`: shown, linked, never actionable. */
  muted: boolean;
  overdue: boolean;
  /** A cancelled row only reaches the agenda as a no-show. */
  noShow: boolean;
};

/** First letters of the first two words, upper-case: "Julio Rangel" -> "JR", "Marta" -> "M". */
const initialsOf = (nombre: string) =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

function vehicleText(row: Pick<AgendaRow, "vehiclePlate" | "vehicleMake" | "vehicleModel"> & { vehicleYear?: number | null }, withYear: boolean): string {
  if (!row.vehiclePlate) return "Sin vehículo";
  const model = [row.vehicleMake, row.vehicleModel, withYear ? row.vehicleYear : null].filter(Boolean).join(" ");
  return model ? `${row.vehiclePlate} · ${model}` : row.vehiclePlate;
}

export function toAgendaItem(row: AgendaRow, now: Date): AgendaItem {
  // Both agenda predicates only admit non-null instants; a null here is a bug upstream, not a blank chip.
  if (!row.appointmentAt) throw new Error(`Agenda row ${row.id} has no appointment instant`);
  const time = formatAgendaTime(row.appointmentAt.toISOString());
  const [hh, mm] = time.split(":").map(Number);
  return {
    id: row.id,
    href: `/service-orders/${row.id}`,
    dayKey: panamaDay(row.appointmentAt),
    time,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    minuteOfDay: hh * 60 + mm,
    vehicleLabel: vehicleText(row, false),
    vehicleDetail: vehicleText(row, true),
    categoria: row.categoria,
    categoriaLabel: categoriaLabel(row.categoria),
    description: row.description,
    technicians: row.technicians.map((t) => ({ ...t, initials: initialsOf(t.nombre) })),
    status: row.status,
    statusLabel: row.noShow ? "No se presentó" : ORDER_STATUS_LABEL[row.status],
    muted: row.status !== "booked",
    overdue: isOverdue(row.status, row.appointmentAt, now),
    noShow: row.noShow,
  };
}

/** Stable chip order inside a day: time, then id. `HH:mm` sorts as text. */
export function sortItems(items: readonly AgendaItem[]): AgendaItem[] {
  return [...items].sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
}

export function groupByDay(items: readonly AgendaItem[]): Map<string, AgendaItem[]> {
  const days = new Map<string, AgendaItem[]>();
  for (const item of sortItems(items)) days.set(item.dayKey, [...(days.get(item.dayKey) ?? []), item]);
  return days;
}

/** An order on the shop floor: no appointment fields, and the hold reason only while `on_hold`. */
export type WorkshopItem = Pick<AgendaItem, "id" | "href" | "customerName" | "customerPhone" | "vehicleLabel" | "categoria" | "status" | "statusLabel"> & {
  /** Initials of the assigned technicians, or "Sin técnico". */
  technicianInitials: string;
  /** Time in the current status: "35 min", "2 h 40 min", "1 día". */
  sinceLabel: string;
  holdReason: string | null;
  /** "hace 2 días"; set exactly when `holdReason` is. */
  holdSinceLabel: string | null;
};

/** "35 min", "2 h 40 min" ("3 h" on the hour), "1 día", "2 días". The spec's wording, not the board's `formatAge` ("2 h", "1 d"). */
function durationText(from: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`;
  const days = Math.floor(minutes / (24 * 60));
  return days === 1 ? "1 día" : `${days} días`;
}

export function toWorkshopItem(row: WorkshopRow, now: Date): WorkshopItem {
  const onHold = row.status === "on_hold" && row.esperaMotivo;
  return {
    id: row.id,
    href: `/service-orders/${row.id}`,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    vehicleLabel: vehicleText(row, false),
    categoria: row.categoria,
    technicianInitials: row.technicians.map((t) => initialsOf(t.nombre)).join(" ") || "Sin técnico",
    status: row.status,
    statusLabel: ORDER_STATUS_LABEL[row.status],
    sinceLabel: durationText(row.sinceAt, now),
    holdReason: onHold ? ESPERA_MOTIVO_LABEL[row.esperaMotivo!] : null,
    holdSinceLabel: onHold ? `hace ${durationText(row.holdSinceAt ?? row.sinceAt, now)}` : null,
  };
}

/** "en 20 min" (under an hour), "en 1 h 20 min" (under a day), else the Panama date as `DD/MM/YYYY`. Digits only: safe to render on the client. */
export function nextLabel(appointmentAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((appointmentAt.getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return `en ${minutes} min`;
  if (minutes < 24 * 60) return minutes % 60 ? `en ${Math.floor(minutes / 60)} h ${minutes % 60} min` : `en ${minutes / 60} h`;
  const [y, m, d] = panamaDay(appointmentAt).split("-");
  return `${d}/${m}/${y}`;
}

/** The "Esta semana" rows in column order. */
export function toWeekSummary(counts: WeekCounts): { label: string; count: number }[] {
  return [
    { label: "Agendadas", count: counts.agendadas },
    { label: "Recibidas", count: counts.recibidas },
    { label: "Vencidas", count: counts.vencidas },
    { label: "No se presentó", count: counts.noShow },
  ];
}
