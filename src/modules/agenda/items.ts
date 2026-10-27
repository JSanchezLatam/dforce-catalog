/**
 * agenda/items.ts - one query row to the plain data the views render. Strings and booleans only:
 * no `Date` crosses a Server Component boundary, and `overdue` is decided here, on the server, from
 * the one `now` the page captured (the client never sees a clock).
 */
import { formatAgendaTime, isOverdue, panamaDay } from "@/modules/agenda/dates";
import type { AgendaRow, WorkshopRow } from "@/modules/agenda/queries";
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

function vehicleText(row: AgendaRow, withYear: boolean): string {
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
export type WorkshopItem = Pick<AgendaItem, "id" | "href" | "customerName" | "customerPhone" | "vehicleLabel" | "status" | "statusLabel"> & {
  holdReason: string | null;
};

export function toWorkshopItem(row: WorkshopRow): WorkshopItem {
  return {
    id: row.id,
    href: `/service-orders/${row.id}`,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    vehicleLabel: row.vehiclePlate ?? "Sin vehículo",
    status: row.status,
    statusLabel: ORDER_STATUS_LABEL[row.status],
    holdReason: row.status === "on_hold" && row.esperaMotivo ? ESPERA_MOTIVO_LABEL[row.esperaMotivo] : null,
  };
}
