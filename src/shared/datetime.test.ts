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

  it("returns the placeholder for a null date, so a caller never renders 'Invalid Date'", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
  });
});

describe("formatDate", () => {
  it("does not slip to the previous day when the host runs east of Panama", () => {
    process.env.TZ = "Asia/Tokyo";
    // 2026-03-10T02:00Z is still 2026-03-09 in Panama, and the 10th in Tokyo.
    expect(formatDate(new Date("2026-03-10T02:00:00Z"))).toContain("9");
  });
});
