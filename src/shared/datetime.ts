/**
 * The workshop's clock, not the server's.
 *
 * `Date.prototype.toLocaleString()` with no arguments resolves locale AND
 * timezone from the host process. Every page in this app is a server
 * component, so the host is Node — on a UTC deployment every appointment
 * rendered that way reads five hours off from what a Panama technician
 * expects, and the reminder text tells the CUSTOMER the wrong hour.
 *
 * C4 task 3.12. This is the read-side counterpart of task 2.10, which fixed
 * the same field's write side: `toDatetimeLocal` had been building the edit
 * input from a UTC wall clock while `new Date()` parsed it back as local. A
 * fixed write path beside an unfixed read path is worse than either alone,
 * because the form and the table disagree and neither is obviously the liar.
 *
 * The zone is HARDCODED, and that is a product decision the owner made: the
 * workshop is in Panama, REVISADO is a Panamanian inspection, and everyone
 * should read the same hour no matter where the server runs. Revisit the day
 * there is a branch in another zone — at which point this one constant is the
 * only thing to change.
 *
 * Client components are deliberately NOT routed through here: they render in
 * the user's browser, which already knows the user's zone.
 */
const WORKSHOP_LOCALE = "es-PA";
const WORKSHOP_TIME_ZONE = "America/Panama";

/** Placeholder shared with the pages, so an unset date never renders "Invalid Date". */
const EMPTY = "—";

export function formatDateTime(value?: Date | string | null): string {
  if (!value) return EMPTY;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return date.toLocaleString(WORKSHOP_LOCALE, { timeZone: WORKSHOP_TIME_ZONE });
}

export function formatDate(value?: Date | string | null): string {
  if (!value) return EMPTY;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return date.toLocaleDateString(WORKSHOP_LOCALE, { timeZone: WORKSHOP_TIME_ZONE });
}
