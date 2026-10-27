/**
 * Agenda date arithmetic. Pure, import-free and client-safe on purpose.
 *
 * A day is a `YYYY-MM-DD` STRING in America/Panama (UTC-5, no DST). Calendar math runs on
 * `Date.UTC` of the key's parts, so neither the server nor the browser zone ever enters. The
 * only instants are the half-open range bounds, built with an explicit `-05:00` offset.
 *
 * No `toLocaleString`: Node emits U+00A0 where Chromium emits U+0020, which breaks hydration.
 * `formatAgendaTime` reads numeric `formatToParts` digits instead.
 */

export type AgendaView = "day" | "week" | "month" | "combined";

const VIEWS: readonly AgendaView[] = ["day", "week", "month", "combined"];
const DAY_MS = 86_400_000;
const PANAMA_OFFSET_MS = 5 * 3_600_000;
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Monday-first, static text: no Intl, so server and browser agree. */
export const WEEKDAY_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;

/** A `booked` order is Vencida once its appointment is MORE than this many minutes past. */
export const OVERDUE_MARGIN_MINUTES = 60;

function keyToUtc(key: string): number {
  const [, y, m, d] = KEY_RE.exec(key)!;
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

function utcToKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** True only for a real calendar date: the round trip rejects `2026-02-30`. */
function isDayKey(value: unknown): value is string {
  return typeof value === "string" && KEY_RE.test(value) && utcToKey(keyToUtc(value)) === value;
}

export function addDays(key: string, days: number): string {
  return utcToKey(keyToUtc(key) + days * DAY_MS);
}

/** The Monday on or before `key`. */
export function weekStart(key: string): string {
  const dow = new Date(keyToUtc(key)).getUTCDay();
  return addDays(key, -((dow + 6) % 7));
}

/** Panama 00:00 of `key` as an instant. */
export function panamaMidnight(key: string): Date {
  return new Date(`${key}T00:00:00-05:00`);
}

/** Week rows (Monday first) the month grid draws: Monday on or before day 1 through Sunday on or after the last day. */
export function monthGrid(key: string): string[][] {
  const first = `${key.slice(0, 7)}-01`;
  const [y, m] = [Number(key.slice(0, 4)), Number(key.slice(5, 7))];
  const last = utcToKey(Date.UTC(y, m, 0));
  const start = weekStart(first);
  const end = addDays(weekStart(last), 6);
  const rows: string[][] = [];
  for (let day = start; day <= end; day = addDays(day, 7)) {
    rows.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
  }
  return rows;
}

/** Half-open [from, to) of Panama midnights covering every visible day of the view. */
export function rangeFor(view: AgendaView, key: string): { from: Date; to: Date } {
  if (view === "week") {
    const start = weekStart(key);
    return { from: panamaMidnight(start), to: panamaMidnight(addDays(start, 7)) };
  }
  if (view === "month") {
    const grid = monthGrid(key);
    return { from: panamaMidnight(grid[0][0]), to: panamaMidnight(addDays(grid[grid.length - 1][6], 1)) };
  }
  return { from: panamaMidnight(key), to: panamaMidnight(addDays(key, 1)) };
}

/** Previous (-1) or next (1) page of the view: a day, a week or a month, the day of month clamped. */
export function stepDate(view: AgendaView, key: string, direction: -1 | 1): string {
  if (view === "week") return addDays(key, 7 * direction);
  if (view !== "month") return addDays(key, direction);
  const total = Number(key.slice(0, 4)) * 12 + (Number(key.slice(5, 7)) - 1) + direction;
  const y = Math.floor(total / 12);
  const m = total % 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(Number(key.slice(8, 10)), lastDay);
  return utcToKey(Date.UTC(y, m, day));
}

/** The Panama day of an instant (today's, for `now`): shifting by the fixed offset avoids any zone lookup. */
export function panamaDay(now: Date): string {
  return utcToKey(now.getTime() - PANAMA_OFFSET_MS);
}

/** Resolves untrusted query values; anything invalid falls back to `week` and today, never throws. */
export function parseAgendaParams(
  raw: { view?: unknown; date?: unknown },
  now: Date,
): { view: AgendaView; date: string } {
  const view = VIEWS.find((v) => v === raw.view) ?? "week";
  const date = isDayKey(raw.date) ? raw.date : panamaDay(now);
  return { view, date };
}

/** Strict: exactly 60 minutes old is not yet Vencida. Only a `booked` order can be. */
export function isOverdue(status: string, appointmentAt: Date, now: Date): boolean {
  return status === "booked" && appointmentAt.getTime() < now.getTime() - OVERDUE_MARGIN_MINUTES * 60_000;
}

// en-US with an explicit h23 cycle: without it en-US reads midnight as a 12-hour "12".
const TIME_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Panama",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "14:05" in Panama time, digits and a colon only. */
export function formatAgendaTime(iso: string): string {
  const p = Object.fromEntries(TIME_PARTS.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute}`;
}
