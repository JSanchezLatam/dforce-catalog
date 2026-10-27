import { describe, expect, it } from "vitest";

import { formatAge } from "./format";

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
