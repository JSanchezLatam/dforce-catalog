/**
 * agenda/grid.ts - the hour grid's geometry, pure. A card is a fixed one-hour block (duration is a follow-up),
 * so a card starting at `minuteOfDay` ends 60 minutes later.
 */

/** Pixel height of one hour row. */
export const ROW = 104;

/** [first hour, hour the grid ends at): 08-18 by default, widened so an out-of-hours card never vanishes, and capped at midnight. */
export function hourWindow(items: readonly { minuteOfDay: number }[]): [number, number] {
  if (items.length === 0) return [8, 18];
  const minutes = items.map((i) => i.minuteOfDay);
  return [Math.min(8, Math.floor(Math.min(...minutes) / 60)), Math.min(24, Math.max(18, Math.ceil((Math.max(...minutes) + 60) / 60)))];
}

/** Offset from the top of the grid, in pixels. */
export const top = (minuteOfDay: number, startHour: number): number => ((minuteOfDay - startHour * 60) / 60) * ROW;

/** Where the now-line sits, or null when today is not shown or the time is outside the grid. */
export function nowLineTop(nowMinute: number, showsToday: boolean, [start, end]: [number, number]): number | null {
  return showsToday && nowMinute >= start * 60 && nowMinute < end * 60 ? top(nowMinute, start) : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `HH:mm`, digits only, so the server and the client print the same text. */
export const clockLabel = (minuteOfDay: number): string => `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;

/** Accessible name of a free-hour control: the day as `DD/MM/YYYY` and the hour, digits only. */
export const slotLabel = (day: string, time: string): string => `Nueva cita ${day.split("-").reverse().join("/")} ${time}`;
