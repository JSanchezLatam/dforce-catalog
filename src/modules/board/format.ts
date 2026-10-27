/** Elapsed time since `since`, both ISO strings off the wire; the caller passes the snapshot's `generatedAt` as `now`. */
export function formatAge(since: string, now: string): string {
  const minutes = Math.max(0, Math.floor((Date.parse(now) - Date.parse(since)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}
