/**
 * metrics/queries.ts — read-only aggregates, no session: the caller authorizes
 * and passes the window (`from`, a `YYYY-MM` key) and, for a técnico's own view,
 * `tecnicoId`. Every count/sum is cast `::int` IN SQL: node-postgres returns
 * bigint and numeric as strings, so an uncast `count(*)` would make `n: number`
 * a lie. Months are bucketed in the workshop's zone, never UTC.
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { ordenLineaTrabajo, ordenServicio, ordenTecnico } from "@/shared/db/schema";
import { BACKLOG_STATUSES, type MonthCount, type StatusCount, type TecnicoMonthCount } from "./shape";

// A constant, not input. Inlined on purpose: a bound zone becomes `$1` in SELECT and `$2` in GROUP BY, and Postgres rejects the mismatch.
const PANAMA = sql.raw("'America/Panama'");

const monthOf = (column: typeof ordenServicio.createdAt | typeof ordenServicio.completedAt) =>
  sql<string>`to_char(date_trunc('month', ${column} AT TIME ZONE ${PANAMA}), 'YYYY-MM')`;

/** First instant of `from`'s month in Panama; keeps the bound sargable on the timestamp column. */
const startOf = (from: string) => sql`(${`${from}-01`}::timestamp AT TIME ZONE ${PANAMA})`;

type Window = { from: string; tecnicoId?: string };

/** Closed (`done`) orders per technician and month; a shared order credits every assignee (PK orden_id, tecnico_id). */
export async function closedByTecnicoMonth({ from, tecnicoId }: Window): Promise<TecnicoMonthCount[]> {
  const mes = monthOf(ordenServicio.completedAt);
  return db
    .select({ tecnicoId: ordenTecnico.tecnicoId, mes, n: sql<number>`count(*)::int` })
    .from(ordenTecnico)
    .innerJoin(ordenServicio, eq(ordenServicio.id, ordenTecnico.ordenId))
    .where(and(eq(ordenServicio.status, "done"), gte(ordenServicio.completedAt, startOf(from)), tecnicoId ? eq(ordenTecnico.tecnicoId, tecnicoId) : undefined))
    .groupBy(ordenTecnico.tecnicoId, mes);
}

/** Minutes worked per technician and month, by the line's `fecha` (a local date, bucketed as-is). */
export async function minutesByTecnicoMonth({ from, tecnicoId }: Window): Promise<TecnicoMonthCount[]> {
  const mes = sql<string>`to_char(${ordenLineaTrabajo.fecha}, 'YYYY-MM')`;
  return db
    .select({ tecnicoId: ordenLineaTrabajo.tecnicoId, mes, n: sql<number>`sum(${ordenLineaTrabajo.duracionMinutos})::int` })
    .from(ordenLineaTrabajo)
    .where(and(gte(ordenLineaTrabajo.fecha, sql`${`${from}-01`}::date`), tecnicoId ? eq(ordenLineaTrabajo.tecnicoId, tecnicoId) : undefined))
    .groupBy(ordenLineaTrabajo.tecnicoId, mes);
}

/** Every order created per month, whatever its status: a cancelled order counts here and nowhere else. */
export async function receivedByMonth({ from }: { from: string }): Promise<MonthCount[]> {
  const mes = monthOf(ordenServicio.createdAt);
  return db
    .select({ mes, n: sql<number>`count(*)::int` })
    .from(ordenServicio)
    .where(gte(ordenServicio.createdAt, startOf(from)))
    .groupBy(mes);
}

/** Orders closed per month: one per order, however many technicians it had. */
export async function closedByMonth({ from }: { from: string }): Promise<MonthCount[]> {
  const mes = monthOf(ordenServicio.completedAt);
  return db
    .select({ mes, n: sql<number>`count(*)::int` })
    .from(ordenServicio)
    .where(and(eq(ordenServicio.status, "done"), gte(ordenServicio.completedAt, startOf(from))))
    .groupBy(mes);
}

/** Open work right now, per status (rows only for statuses that have orders; `fillBacklog` zero-fills). */
export async function backlogByStatus(): Promise<StatusCount[]> {
  return db
    .select({ status: ordenServicio.status, n: sql<number>`count(*)::int` })
    .from(ordenServicio)
    .where(inArray(ordenServicio.status, [...BACKLOG_STATUSES]))
    .groupBy(ordenServicio.status);
}
