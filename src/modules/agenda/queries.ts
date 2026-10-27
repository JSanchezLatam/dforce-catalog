/**
 * agenda/queries.ts - read-only reads for /agenda. No session: the caller authorizes and passes the
 * `OrderScope`, which is REQUIRED so a forgotten scope is a tsc error, not a leak.
 *
 * Every instant is a bound parameter computed by `dates.ts` (Panama midnights), so neither the
 * database session zone nor the server zone can move a boundary. Each read fetches `cap + 1` rows:
 * more than `cap` back means "truncated", and the extra row is dropped before returning.
 * `count(*)` is never selected raw: pg returns bigint as a string, drizzle's `count()` maps it to a number.
 */
import { and, asc, count, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import { OVERDUE_MARGIN_MINUTES } from "@/modules/agenda/dates";
import { BACKLOG_STATUSES } from "@/modules/metrics/shape";
import type { OrderScope } from "@/modules/service-orders/scope";
import { db } from "@/shared/db/client";
import { cliente, ordenServicio, ordenTecnico, tecnico, vehiculo } from "@/shared/db/schema";

export const AGENDA_ROW_CAP = 500;

// `appointmentAt` is typed nullable by the column; both predicates below only admit non-null rows.
const COLUMNS = {
  id: ordenServicio.id,
  status: ordenServicio.status,
  appointmentAt: ordenServicio.appointmentAt,
  customerName: cliente.name,
  customerPhone: cliente.phone,
  vehiclePlate: vehiculo.plate,
  vehicleMake: vehiculo.make,
  vehicleModel: vehiculo.model,
  vehicleYear: vehiculo.year,
  categoria: ordenServicio.categoria,
  description: ordenServicio.description,
};

export type AgendaRow = {
  id: string;
  status: (typeof ordenServicio.$inferSelect)["status"];
  appointmentAt: Date | null;
  customerName: string;
  customerPhone: string;
  /** Null when the order has no vehicle (a booked order may omit it). */
  vehiclePlate: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleYear: number | null;
  /** Null while the order is a `booked` one with no type yet. */
  categoria: (typeof ordenServicio.$inferSelect)["categoria"];
  description: string | null;
  /** A cancelled row only reaches the agenda as a no-show, so this is `status === "cancelled"`. */
  noShow: boolean;
  /** Active technicians only, by name. */
  technicians: { id: string; nombre: string }[];
};

export type AgendaPage = { rows: AgendaRow[]; truncated: boolean };

// Instants compare as instants, so no zone logic belongs here.
const NO_SHOW = sql`EXISTS (
  SELECT 1 FROM orden_estado_historial h
  WHERE h.orden_id = ${ordenServicio.id} AND h.from_status = 'booked' AND h.to_status = 'cancelled' AND h.changed_at > ${ordenServicio.appointmentAt}
)`;

/** Active technicians per order, by name. A second query, not a join: a join would multiply the order rows. */
async function techniciansByOrder(ids: string[]): Promise<Map<string, AgendaRow["technicians"]>> {
  const byOrder = new Map<string, AgendaRow["technicians"]>();
  if (ids.length === 0) return byOrder;
  const rows = await db
    .select({ ordenId: ordenTecnico.ordenId, id: tecnico.id, nombre: tecnico.nombre })
    .from(ordenTecnico)
    .innerJoin(tecnico, eq(tecnico.id, ordenTecnico.tecnicoId))
    // A deactivated technician is off the roster, so off the card.
    .where(and(inArray(ordenTecnico.ordenId, ids), isNull(tecnico.deactivatedAt)))
    .orderBy(asc(tecnico.nombre), asc(tecnico.id));
  for (const { ordenId, ...t } of rows) byOrder.set(ordenId, [...(byOrder.get(ordenId) ?? []), t]);
  return byOrder;
}

type BaseRow = Omit<AgendaRow, "noShow" | "technicians">;

async function withExtras(rows: BaseRow[]): Promise<AgendaRow[]> {
  const techs = await techniciansByOrder(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, noShow: r.status === "cancelled", technicians: techs.get(r.id) ?? [] }));
}

/** Appointments in the half-open [from, to), oldest first. Cancelled is excluded unless it was cancelled from `booked` after the appointment time (a no-show). */
export async function agendaRange(scope: OrderScope, range: { from: Date; to: Date }, cap = AGENDA_ROW_CAP): Promise<AgendaPage> {
  const rows = await db
    .select(COLUMNS)
    .from(ordenServicio)
    .innerJoin(cliente, eq(ordenServicio.clienteId, cliente.id))
    .leftJoin(vehiculo, eq(ordenServicio.vehiculoId, vehiculo.id))
    .where(and(gte(ordenServicio.appointmentAt, range.from), lt(ordenServicio.appointmentAt, range.to), or(ne(ordenServicio.status, "cancelled"), NO_SHOW), scope.where))
    .orderBy(asc(ordenServicio.appointmentAt), asc(ordenServicio.id))
    .limit(cap + 1);
  return { rows: await withExtras(rows.slice(0, cap)), truncated: rows.length > cap };
}

/** Booked orders whose appointment is more than the margin in the past, whatever the visible range; `total` is the true count. */
export async function agendaOverdue(scope: OrderScope, now: Date, cap = AGENDA_ROW_CAP): Promise<AgendaPage & { total: number }> {
  const overdue = and(
    eq(ordenServicio.status, "booked"),
    lt(ordenServicio.appointmentAt, new Date(now.getTime() - OVERDUE_MARGIN_MINUTES * 60_000)),
    scope.where,
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select(COLUMNS)
      .from(ordenServicio)
      .innerJoin(cliente, eq(ordenServicio.clienteId, cliente.id))
      .leftJoin(vehiculo, eq(ordenServicio.vehiculoId, vehiculo.id))
      .where(overdue)
      .orderBy(asc(ordenServicio.appointmentAt), asc(ordenServicio.id))
      .limit(cap + 1),
    db.select({ total: count() }).from(ordenServicio).where(overdue),
  ]);
  return { rows: await withExtras(rows.slice(0, cap)), truncated: rows.length > cap, total };
}

/** Orders on the shop floor now: every backlog status but `booked` (an appointment, not a car in the workshop). */
export const IN_WORKSHOP_STATUSES = BACKLOG_STATUSES.filter((s) => s !== "booked");

export type WorkshopRow = {
  id: string;
  status: AgendaRow["status"];
  /** Set only while `on_hold`. */
  esperaMotivo: (typeof ordenServicio.$inferSelect)["esperaMotivo"];
  customerName: string;
  customerPhone: string;
  vehiclePlate: string | null;
};

/** Every in-workshop order whatever its appointment date, oldest first. Lives here, not in `board/`, because it joins `cliente`. */
export async function agendaInWorkshop(scope: OrderScope, cap = AGENDA_ROW_CAP): Promise<{ rows: WorkshopRow[]; truncated: boolean }> {
  const rows = await db
    .select({
      id: ordenServicio.id,
      status: ordenServicio.status,
      esperaMotivo: ordenServicio.esperaMotivo,
      customerName: cliente.name,
      customerPhone: cliente.phone,
      vehiclePlate: vehiculo.plate,
    })
    .from(ordenServicio)
    .innerJoin(cliente, eq(ordenServicio.clienteId, cliente.id))
    .leftJoin(vehiculo, eq(ordenServicio.vehiculoId, vehiculo.id))
    .where(and(inArray(ordenServicio.status, IN_WORKSHOP_STATUSES), scope.where))
    .orderBy(asc(ordenServicio.createdAt), asc(ordenServicio.id))
    .limit(cap + 1);
  return { rows: rows.slice(0, cap), truncated: rows.length > cap };
}
