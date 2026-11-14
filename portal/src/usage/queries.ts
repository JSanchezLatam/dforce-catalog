import { sql } from "drizzle-orm";

import { db } from "../db/client";

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

/** `?r=` to a range. Anything but exactly 7, 30 or 90 is the default, 30. */
export function parseRange(value: string | string[] | undefined): Range {
  return RANGES.find((r) => String(r) === value) ?? 30;
}

const DAY_MS = 24 * 60 * 60_000;
/** Stale only when strictly more than one day passed since the newest delivery. */
export const isStale = (newest: Date, now: Date): boolean => now.getTime() - newest.getTime() > DAY_MS;

export interface UsageDay {
  day: string;
  covered: boolean;
  gestion: number;
  tecnico: number;
}
export interface ScreenTotal {
  screen: string;
  gestion: number;
  tecnico: number;
}
export interface UsageReport {
  /** The workshop's date (America/Panama), from the database clock. */
  today: string;
  /** Newest `received_at`; null when the workshop never delivered. */
  newest: Date | null;
  /** Panama days between the newest delivery and today. */
  newestAgeDays: number | null;
  /** One row per day of the range, oldest first. An uncovered day carries zeros that are NOT data. */
  days: UsageDay[];
  /** Totals over the covered days of the range only. */
  screens: ScreenTotal[];
  catalog: { pattern: string; label: string }[];
  /** Last day with views per screen, within the last 90 days. */
  lastSeen: Record<string, string>;
}

// One clock: the database's, in the workshop's time zone (design D3).
const TODAY = sql.raw("(now() at time zone 'America/Panama')::date");

// Raw execute bypasses drizzle's column decoders: sum() (bigint) and extract() (numeric)
// arrive as strings, so every number is converted here.
type Row = Record<string, unknown>;
const run = async (q: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(q)).rows;

export async function usageReport(range: Range): Promise<UsageReport> {
  const back = range - 1;
  const [meta, days, screens, catalog, seen] = await Promise.all([
    run(sql`select ${TODAY}::text as today, extract(epoch from max(received_at)) as newest,
      ${TODAY} - (max(received_at) at time zone 'America/Panama')::date as newest_age from usage_coverage`),
    run(sql`select d::date::text as day, c.day is not null as covered,
      coalesce(sum(u.views) filter (where u.role_group = 'gestion'), 0) as gestion,
      coalesce(sum(u.views) filter (where u.role_group = 'tecnico'), 0) as tecnico
      from generate_series(${TODAY} - ${back}::int, ${TODAY}, interval '1 day') d
      left join usage_coverage c on c.day = d::date
      left join usage_count u on u.day = c.day
      group by d, c.day order by d`),
    run(sql`select u.screen, u.role_group, sum(u.views) as views
      from usage_count u join usage_coverage c on c.day = u.day
      where u.day between ${TODAY} - ${back}::int and ${TODAY}
      group by u.screen, u.role_group`),
    run(sql`select pattern, label from usage_screen order by label`),
    run(sql`select screen, max(day)::text as last from usage_count
      where views > 0 and day > ${TODAY} - 90 group by screen`),
  ]);

  const m = meta[0] ?? {};
  const totals = new Map<string, ScreenTotal>();
  for (const r of screens) {
    const screen = String(r.screen);
    const t = totals.get(screen) ?? { screen, gestion: 0, tecnico: 0 };
    if (r.role_group === "gestion" || r.role_group === "tecnico") t[r.role_group] += Number(r.views);
    totals.set(screen, t);
  }
  return {
    today: String(m.today),
    newest: m.newest == null ? null : new Date(Math.round(Number(m.newest) * 1000)),
    newestAgeDays: m.newest_age == null ? null : Number(m.newest_age),
    days: days.map((r) => ({ day: String(r.day), covered: r.covered === true, gestion: Number(r.gestion), tecnico: Number(r.tecnico) })),
    screens: [...totals.values()],
    catalog: catalog.map((r) => ({ pattern: String(r.pattern), label: String(r.label) })),
    lastSeen: Object.fromEntries(seen.map((r) => [String(r.screen), String(r.last)])),
  };
}
