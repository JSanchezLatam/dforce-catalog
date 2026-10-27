/**
 * agenda/queries.ts - read-only reads for /agenda. No session: the caller authorizes and passes the
 * `OrderScope`, which is REQUIRED so a forgotten scope is a tsc error, not a leak.
 *
 * Every instant is a bound parameter computed by `dates.ts` (Panama midnights), so neither the
 * database session zone nor the server zone can move a boundary. Each read fetches `cap + 1` rows:
 * more than `cap` back means "truncated", and the extra row is dropped before returning.
 * `count(*)` is never selected raw: pg returns bigint as a string, drizzle's `count()` maps it to a number.
 */
import { and, asc, count, eq, gte, inArray, lt, ne } from "drizzle-orm";

import { OVERDUE_MARGIN_MINUTES } from "@/modules/agenda/dates";
import { BACKLOG_STATUSES } from "@/modules/metrics/shape";
import type { OrderScope } from "@/modules/service-orders/scope";
import { db } from "@/shared/db/client";
import { cliente, ordenServicio, vehiculo } from "@/shared/db/schema";

export const AGENDA_ROW_CAP = 500;

// `appointmentAt` is typed nullable by the column; both predicates below only admit non-null rows.
const COLUMNS = {
  id: ordenServicio.id,
  status: ordenServicio.status,
  appointmentAt: ordenServicio.appointmentAt,
  customerName: cliente.name,
  customerPhone: cliente.phone,
  vehiclePlate: vehiculo.plate,
};

export type AgendaRow = {
  id: string;
  status: (typeof ordenServicio.$inferSelect)["status"];
  appointmentAt: Date | null;
  customerName: string;
  customerPhone: string;
  /** Null when the order has no vehicle (a booked order may omit it). */
  vehiclePlate: string | null;
};

export type AgendaPage = { rows: AgendaRow[]; truncated: boolean };

/** Appointments in the half-open [from, to), cancelled excluded, oldest first. */
export async function agendaRange(scope: OrderScope, range: { from: Date; to: Date }, cap = AGENDA_ROW_CAP): Promise<AgendaPage> {
  const rows = await db
    .select(COLUMNS)
    .from(ordenServicio)
    .innerJoin(cliente, eq(ordenServicio.clienteId, cliente.id))
    .leftJoin(vehiculo, eq(ordenServicio.vehiculoId, vehiculo.id))
    .where(and(gte(ordenServicio.appointmentAt, range.from), lt(ordenServicio.appointmentAt, range.to), ne(ordenServicio.status, "cancelled"), scope.where))
    .orderBy(asc(ordenServicio.appointmentAt), asc(ordenServicio.id))
    .limit(cap + 1);
  return { rows: rows.slice(0, cap), truncated: rows.length > cap };
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
  return { rows: rows.slice(0, cap), truncated: rows.length > cap, total };
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
