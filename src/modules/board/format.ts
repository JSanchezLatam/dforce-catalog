/** Elapsed time since `since`, both ISO strings off the wire; the caller passes the snapshot's `generatedAt` as `now`. */
export function formatAge(since: string, now: string): string {
  const minutes = Math.max(0, Math.floor((Date.parse(now) - Date.parse(since)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

const PANAMA_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Panama",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * "05/11 10:30" in Panama time, built from numeric parts only. `toLocaleString("es-PA")` emits
 * U+00A0 in "a. m." under Node and U+0020 under Chromium, so a client component rendering it
 * fails hydration; digits agree everywhere.
 */
export function formatBoardTime(iso: string): string {
  const p = Object.fromEntries(PANAMA_PARTS.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}
