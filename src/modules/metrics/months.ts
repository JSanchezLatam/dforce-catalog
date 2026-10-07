/**
 * Month keys (`YYYY-MM`) in the workshop's calendar. Built from `toWorkshopDateKey`,
 * never from UTC fields: at 04:59Z on the 1st Panama is still the previous month.
 */
import { toWorkshopDateKey } from "@/shared/datetime";

export function currentMonthKey(now: Date): string {
  return toWorkshopDateKey(now).slice(0, 7);
}

/** The last `count` workshop months ending at `now`'s, oldest first. */
export function monthKeys(now: Date, count: number): string[] {
  const [year, month] = currentMonthKey(now).split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const index = year * 12 + (month - 1) - (count - 1 - i);
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  });
}

/** `?mes=` is user input: only a key in the 12-month list is trusted, anything else is the current month. */
export function parseMes(raw: unknown, now: Date): string {
  return typeof raw === "string" && monthKeys(now, 12).includes(raw) ? raw : currentMonthKey(now);
}

// A fixed map, not `Intl`: the label is built from the KEY, so no `Date` (and no
// zone) is involved and a month can never come out one off.
const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** `2026-10` -> `Octubre 2026`. */
export function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}
