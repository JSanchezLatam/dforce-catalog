/**
 * board/shape.ts - pure row mapping for the two status boards. Server-only: it
 * imports `CUSTOMER_STATUS` from portal-sync, whose module pulls `node:crypto`.
 *
 * Every output field is written out by name and no source row is ever spread:
 * a column added to a table later reaches a TV only if somebody types it here.
 * All instants leave as ISO strings (they cross the RSC boundary and JSON).
 */
import { CUSTOMER_STATUS } from "@/modules/portal-sync/snapshot";
import { ESPERA_MOTIVO_LABEL, ORDER_STATUS_LABEL } from "@/modules/service-orders/statuses";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import type { OrdenServicio } from "@/shared/db/schema";
import { BACKLOG_STATUSES } from "@/modules/metrics/shape";

/** Exactly the columns `queries.ts` selects. `id` is a join key and never leaves. */
export type BoardOrderRow = Pick<OrdenServicio, "id" | "status" | "esperaMotivo" | "updatedAt" | "appointmentAt"> & {
  // null: a `booked` order may have no vehicle (left join).
  plate: string | null;
  make: string | null;
  model: string | null;
};
export type BoardTechRow = { ordenId: string; nombre: string };
export type BoardSinceRow = { ordenId: string; changedAt: Date };

export type BoardRow = {
  status: OrderStatus;
  statusLabel: string;
  plate: string;
  make: string | null;
  model: string | null;
  holdReason: string | null;
  technicians: string[];
  statusSince: string;
  /** Present only while `booked`. */
  appointmentAt?: string | null;
};
export type BoardSnapshot = { generatedAt: string; rows: BoardRow[] };

export type CustomerRow = { plate: string; make: string | null; model: string | null; status: string };
export type CustomerSnapshot = { generatedAt: string; rows: CustomerRow[] };

const STATUS_ORDER: readonly string[] = [...BACKLOG_STATUSES, "done"];

export function toBoardSnapshot(rows: BoardOrderRow[], techs: BoardTechRow[], since: BoardSinceRow[], now: Date): BoardSnapshot {
  const sinceById = new Map(since.map((s) => [s.ordenId, s.changedAt]));
  const mapped = rows.map((r) => {
    const row: BoardRow = {
      status: r.status,
      statusLabel: ORDER_STATUS_LABEL[r.status],
      plate: r.plate ?? "Sin vehículo",
      make: r.make,
      model: r.model,
      holdReason: r.status === "on_hold" && r.esperaMotivo ? ESPERA_MOTIVO_LABEL[r.esperaMotivo] : null,
      technicians: techs.filter((t) => t.ordenId === r.id).map((t) => t.nombre),
      statusSince: (sinceById.get(r.id) ?? r.updatedAt).toISOString(),
    };
    if (r.status === "booked") row.appointmentAt = r.appointmentAt ? r.appointmentAt.toISOString() : null;
    return row;
  });
  mapped.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || Date.parse(a.statusSince) - Date.parse(b.statusSince));
  return { generatedAt: now.toISOString(), rows: mapped };
}

export function toCustomerSnapshot(rows: BoardOrderRow[], now: Date): CustomerSnapshot {
  const visible: CustomerRow[] = [];
  for (const r of rows) {
    // The query already excludes these; the mapper is the second lock.
    if (r.plate === null || r.status === "booked" || r.status === "cancelled") continue;
    visible.push({ plate: r.plate, make: r.make, model: r.model, status: CUSTOMER_STATUS[r.status] });
  }
  return { generatedAt: now.toISOString(), rows: visible };
}
