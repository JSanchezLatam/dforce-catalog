import { describe, expect, it } from "vitest";

import { hourWindow, nowLineTop, ROW, top } from "./grid";

const at = (h: number, m = 0) => ({ minuteOfDay: h * 60 + m });

describe("hourWindow", () => {
  it("Grid hours: 08:00 through 18:00 by default and for a day inside it", () => {
    expect(hourWindow([])).toEqual([8, 18]);
    expect(hourWindow([at(8), at(14, 30), at(17)])).toEqual([8, 18]);
  });

  it("Outside the window: 07:15 and 18:45 widen it to 07:00 - 20:00", () => {
    expect(hourWindow([at(7, 15), at(18, 45)])).toEqual([7, 20]);
  });

  it("each side widens on its own", () => {
    expect(hourWindow([at(7, 15)])).toEqual([7, 18]);
    expect(hourWindow([at(18, 45)])).toEqual([8, 20]);
  });

  it("the grid never runs past midnight: a 23:30 card ends the window at 24", () => {
    expect(hourWindow([at(23, 30)])).toEqual([8, 24]);
    expect(hourWindow([at(23)])).toEqual([8, 24]);
  });

  it("a card starting on the closing hour gets its own row", () => {
    expect(hourWindow([at(18)])).toEqual([8, 19]);
  });
});

describe("top", () => {
  it("Grid hours: 14:30 sits half a row below 14:00", () => {
    expect(ROW).toBe(104);
    expect(top(14 * 60 + 30, 8) - top(14 * 60, 8)).toBe(ROW / 2);
    expect(top(8 * 60, 8)).toBe(0);
    expect(top(14 * 60, 8)).toBe(6 * ROW);
  });

  it("is relative to the window start", () => {
    expect(top(7 * 60 + 15, 7)).toBe(ROW / 4);
  });
});

describe("nowLineTop", () => {
  it("Now-line only on today: inside the window it returns the offset", () => {
    expect(nowLineTop(10 * 60 + 40, true, [8, 18])).toBe(top(10 * 60 + 40, 8));
  });

  it("Now-line outside the grid: 19:30 on the default window shows none", () => {
    expect(nowLineTop(19 * 60 + 30, true, [8, 18])).toBeNull();
    expect(nowLineTop(7 * 60 + 59, true, [8, 18])).toBeNull();
    expect(nowLineTop(18 * 60, true, [8, 18])).toBeNull();
  });

  it("Now-line only on today: none when today is not among the shown days", () => {
    expect(nowLineTop(10 * 60 + 40, false, [8, 18])).toBeNull();
  });
});
