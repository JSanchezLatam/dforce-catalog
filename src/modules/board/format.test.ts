import { describe, expect, it } from "vitest";

import { formatAge, formatBoardTime } from "./format";

const NOW = "2026-10-26T15:00:00.000Z";
const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();
const MIN = 60_000;

describe("Time in Status - Duration formatting: formatAge()", () => {
  it.each([
    [0, "0 min"],
    [12 * MIN, "12 min"],
    [59 * MIN, "59 min"],
    [60 * MIN, "1 h"],
    [3 * 60 * MIN + 59 * MIN, "3 h"],
    [23 * 60 * MIN, "23 h"],
    [24 * 60 * MIN, "1 d"],
    [2 * 24 * 60 * MIN + 5 * MIN, "2 d"],
  ])("reads %i ms as %s", (elapsed, expected) => {
    expect(formatAge(ago(elapsed), NOW)).toBe(expected);
  });

  it("a start in the future reads as zero minutes, never negative", () => {
    expect(formatAge(ago(-5 * 60 * MIN), NOW)).toBe("0 min");
  });
});

describe("Booked Rows - formatBoardTime(): deterministic, locale-text-free", () => {
  it("renders a known instant in Panama time (UTC-5), exact string", () => {
    // 15:30Z is 10:30 in Panama; Panama has no DST.
    expect(formatBoardTime("2026-11-05T15:30:00.000Z")).toBe("05/11 10:30");
  });

  it("crosses the Panama day boundary, not the UTC one", () => {
    expect(formatBoardTime("2026-11-06T03:05:00.000Z")).toBe("05/11 22:05");
  });

  it("is digits and separators only: no NBSP, no a. m./p. m. (Node and browsers disagree on those)", () => {
    for (const iso of ["2026-11-05T15:30:00Z", "2026-11-05T02:00:00Z", "2026-11-05T19:45:00Z"]) {
      expect(formatBoardTime(iso)).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
    }
  });
});
