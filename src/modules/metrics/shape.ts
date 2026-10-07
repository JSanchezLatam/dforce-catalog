/** Pure shaping of query rows: zero-fill against a key list, minutes to hours. */

export type MonthCount = { mes: string; n: number };
export type TecnicoMonthCount = { tecnicoId: string; mes: string; n: number };
export type StatusCount = { status: string; n: number };

export const BACKLOG_STATUSES = ["open", "in_progress", "ready_for_review"] as const;
export type BacklogStatus = (typeof BACKLOG_STATUSES)[number];

export function fillMonths(keys: string[], rows: MonthCount[]): { key: string; value: number }[] {
  const byMonth = new Map(rows.map((r) => [r.mes, r.n]));
  return keys.map((key) => ({ key, value: byMonth.get(key) ?? 0 }));
}

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

export function fillBacklog(rows: StatusCount[]): Record<BacklogStatus, number> {
  const byStatus = new Map(rows.map((r) => [r.status, r.n]));
  return { open: byStatus.get("open") ?? 0, in_progress: byStatus.get("in_progress") ?? 0, ready_for_review: byStatus.get("ready_for_review") ?? 0 };
}

export type TecnicoMonthRow = { tecnicoId: string; nombre: string; closed: number; hours: number };

/**
 * One row per technician for `mes`. A shared order is credited to each assignee,
 * so this column's sum can exceed the order total (`closedByMonth`). An inactive
 * technician appears only when the month has numbers for them.
 */
export function shapeTechnicianMonth(input: {
  roster: { id: string; nombre: string; active: boolean }[];
  closed: TecnicoMonthCount[];
  minutes: TecnicoMonthCount[];
  mes: string;
}): TecnicoMonthRow[] {
  const pick = (rows: TecnicoMonthCount[], id: string) => rows.find((r) => r.tecnicoId === id && r.mes === input.mes)?.n ?? 0;
  return input.roster
    .map((t) => ({ tecnicoId: t.id, nombre: t.nombre, closed: pick(input.closed, t.id), hours: minutesToHours(pick(input.minutes, t.id)), active: t.active }))
    .filter((r) => r.active || r.closed > 0 || r.hours > 0)
    .map((r) => ({ tecnicoId: r.tecnicoId, nombre: r.nombre, closed: r.closed, hours: r.hours }));
}
