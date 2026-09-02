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
 * there is a branch in another zone — at which point the two constants below
 * are the only thing to change.
 *
 * The parameter is `Date`, never `string`, and that is load-bearing rather
 * than tidy: every one of the eleven call sites already holds a `Date`, and a
 * date-ONLY string like "2026-03-10" parses as UTC midnight, which this module
 * would then render as the 9th — an off-by-a-day inside the helper whose whole
 * job is stopping off-by-a-timezone. `ClienteListItem.createdAt` really does
 * cross the wire as an ISO string (follow-up 1.19), so that caller is not
 * hypothetical; the type makes it a compile error instead of a wrong date.
 *
 * Client components are NOT automatically exempt, and the tempting shorthand
 * — "they render in the browser, which knows the user's zone" — is only true
 * for some of them. A `"use client"` component is still SERVER-rendered for
 * the initial HTML, so one that formats a server-supplied `Date` in its render
 * path produces that first paint in the server's zone and then disagrees with
 * itself on hydration. `CatalogGrid` was exactly that and is routed through
 * here now. What is genuinely exempt is a date formatted from browser-side
 * state that never touches SSR: `ManualSyncButton` formats inside a `fetch`
 * callback, and `CustomerPicker` formats client-fetched search results.
 */
const WORKSHOP_LOCALE = "es-PA";
const WORKSHOP_TIME_ZONE = "America/Panama";

/** Placeholder shared with the pages, so an unset date never renders "Invalid Date". */
const EMPTY = "—";

export function formatDateTime(value: Date | null | undefined): string {
  if (!value) return EMPTY;
  return value.toLocaleString(WORKSHOP_LOCALE, { timeZone: WORKSHOP_TIME_ZONE });
}

export function formatDate(value: Date | null | undefined): string {
  if (!value) return EMPTY;
  return value.toLocaleDateString(WORKSHOP_LOCALE, { timeZone: WORKSHOP_TIME_ZONE });
}
