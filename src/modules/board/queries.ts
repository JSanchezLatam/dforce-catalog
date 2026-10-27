/**
 * board/queries.ts - read-only reads for the two status boards. No session: the
 * caller authorizes. The customer table is never joined or selected here;
 * `queries.privacy.test.ts` enforces it on this file's text. Three batched
 * queries per snapshot (orders, technicians, history), never one per order.
 */
import { and, asc, eq, gte, inArray, max, or, sql } from "drizzle-orm";

import { BACKLOG_STATUSES } from "@/modules/metrics/shape";
import { db } from "@/shared/db/client";
import { toWorkshopDateKey } from "@/shared/datetime";
import { ordenEstadoHistorial, ordenServicio, ordenTecnico, tecnico, vehiculo } from "@/shared/db/schema";
import type { BoardOrderRow, BoardSinceRow, BoardTechRow } from "./shape";

// Inlined constant, not input (same reason as metrics/queries.ts).
const PANAMA = sql.raw("'America/Panama'");

/** First instant of the workshop's current day, in Panama whatever the server or DB zone. */
const startOfToday = (now: Date) => sql`(${toWorkshopDateKey(now)}::timestamp AT TIME ZONE ${PANAMA})`;

/** Open work plus `done` completed today. `booked` is for staff only. */
async function boardOrders(now: Date, includeBooked: boolean): Promise<BoardOrderRow[]> {
  const open = BACKLOG_STATUSES.filter((s) => includeBooked || s !== "booked");
  return db
    .select({
      id: ordenServicio.id,
      status: ordenServicio.status,
      esperaMotivo: ordenServicio.esperaMotivo,
      updatedAt: ordenServicio.updatedAt,
      appointmentAt: ordenServicio.appointmentAt,
      plate: vehiculo.plate,
      make: vehiculo.make,
      model: vehiculo.model,
    })
    .from(ordenServicio)
    .leftJoin(vehiculo, eq(vehiculo.id, ordenServicio.vehiculoId))
    .where(or(inArray(ordenServicio.status, open), and(eq(ordenServicio.status, "done"), gte(ordenServicio.completedAt, startOfToday(now)))))
    .orderBy(asc(ordenServicio.createdAt));
}

export const customerBoardOrders = (now: Date = new Date()) => boardOrders(now, false);

export async function workshopBoardData(now: Date = new Date()): Promise<{ rows: BoardOrderRow[]; techs: BoardTechRow[]; since: BoardSinceRow[] }> {
  const rows = await boardOrders(now, true);
  if (rows.length === 0) return { rows, techs: [], since: [] };
  const ids = rows.map((r) => r.id);
  const [techs, since] = await Promise.all([
    db
      .select({ ordenId: ordenTecnico.ordenId, nombre: tecnico.nombre })
      .from(ordenTecnico)
      .innerJoin(tecnico, eq(tecnico.id, ordenTecnico.tecnicoId))
      .where(inArray(ordenTecnico.ordenId, ids))
      .orderBy(asc(tecnico.nombre)),
    db
      .select({ ordenId: ordenEstadoHistorial.ordenId, changedAt: max(ordenEstadoHistorial.changedAt) })
      .from(ordenEstadoHistorial)
      .where(inArray(ordenEstadoHistorial.ordenId, ids))
      .groupBy(ordenEstadoHistorial.ordenId),
  ]);
  // `max()` is nullable in its type only: a group exists because it has a row, and `changed_at` is NOT NULL.
  return { rows, techs, since: since as BoardSinceRow[] };
}
