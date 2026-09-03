/**
 * The TZ is pinned per-case rather than inherited: these assertions exist to
 * prove the SERVER's zone does not leak into what a user reads, and on a UTC
 * machine — CI — an inherited-zone bug passes them silently.
 *
 * Restored with `delete`, never `= REAL_TZ`: this machine has no TZ set, so
 * that assignment stores the STRING "undefined", which Node reads as an
 * invalid zone and falls back to UTC, handing every later test the exact
 * machine this pin exists to avoid.
 */
import { afterEach, describe, expect, it } from "vitest";

import { formatDateTime, formatDate } from "./datetime";

const REAL_TZ = process.env.TZ;
afterEach(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

const APPOINTMENT = new Date("2026-03-10T14:00:00Z"); // 09:00 in Panama

describe("formatDateTime", () => {
  it.each(["UTC", "Europe/Madrid", "Asia/Tokyo", "America/Panama"])(
    "renders the workshop's own hour regardless of the host zone (%s)",
    (hostZone) => {
      process.env.TZ = hostZone;
      expect(formatDateTime(APPOINTMENT)).toContain("9:00");
    },
  );

  /**
   * The zone assertions above are all locale-AGNOSTIC — "9:00" appears in both
   * es-PA and en-US — so `WORKSHOP_LOCALE` could be deleted, misspelled or set
   * to en-US and every one of them would stay green. This is the only thing in
   * the repo that pins it.
   *
   * Note what this guards and what it does not: `a. m.` also matches es-MX
   * and es-419, so it pins es-PA against ENGLISH, not against another Spanish
   * locale. `formatDate`'s zero-padded `03/09/2026` is the stricter half.
   *
   * The separator is `\s`, not a literal space: es-PA emits U+00A0 between the
   * meridiem letters here, and newer ICU builds emit U+202F, so a hardcoded
   * space passes on one Node and fails on another.
   */
  it("renders in Panamanian Spanish, not the host's locale", () => {
    process.env.TZ = "UTC";
    expect(formatDateTime(APPOINTMENT)).toMatch(/a\.\s?m\./); // en-US would say "AM"
  });

  it("returns the placeholder for a null date, so a caller never renders 'Invalid Date'", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
  });
});

describe("formatDate", () => {
  it("does not slip to the previous day when the host runs east of Panama", () => {
    process.env.TZ = "Asia/Tokyo";
    // 2026-03-10T02:00Z is still 2026-03-09 in Panama, and the 10th in Tokyo.
    // Zero-padded and es-PA-ordered: en-US would render "3/9/2026", so this
    // pins the locale as well as the day.
    expect(formatDate(new Date("2026-03-10T02:00:00Z"))).toBe("03/09/2026");
  });
});
