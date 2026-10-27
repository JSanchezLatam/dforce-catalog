import { describe, expect, it } from "vitest";

import {
  OVERDUE_MARGIN_MINUTES,
  addDays,
  formatAgendaTime,
  isOverdue,
  monthGrid,
  panamaMidnight,
  parseAgendaParams,
  rangeFor,
  stepDate,
  weekStart,
} from "./dates";

const iso = (d: Date) => d.toISOString();

describe("Agenda URL, View and Date Parameters", () => {
  it("Defaults: no params resolve to week and the Panama day, not the UTC day", () => {
    // 22:30 Panama on 2026-10-26 is already 2026-10-27 in UTC.
    const now = new Date("2026-10-27T03:30:00Z");
    expect(parseAgendaParams({}, now)).toEqual({ view: "week", date: "2026-10-26" });
  });

  it.each([
    ["year", "2026-13-45"],
    ["year", "abc"],
    ["year", "2026-02-30"],
    [undefined, "2026-2-3"],
    [["day", "week"], ["2026-10-01"]],
  ])("Invalid params fall back: view=%j date=%j", (view, date) => {
    const now = new Date("2026-10-27T03:30:00Z");
    expect(parseAgendaParams({ view, date }, now)).toEqual({ view: "week", date: "2026-10-26" });
  });

  it("keeps a valid view and date", () => {
    const now = new Date("2026-10-27T03:30:00Z");
    expect(parseAgendaParams({ view: "month", date: "2028-02-29" }, now)).toEqual({ view: "month", date: "2028-02-29" });
  });

  it("Week starts Monday: Sunday 2026-10-25 belongs to the week of 2026-10-19", () => {
    expect(weekStart("2026-10-25")).toBe("2026-10-19");
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
    const { from, to } = rangeFor("week", "2026-10-25");
    expect(iso(from)).toBe("2026-10-19T05:00:00.000Z");
    expect(iso(to)).toBe("2026-10-26T05:00:00.000Z");
  });

  it("Navigation steps: one day in day and combined, one week in week, one month in month", () => {
    expect(stepDate("day", "2026-10-31", 1)).toBe("2026-11-01");
    expect(stepDate("combined", "2026-10-01", -1)).toBe("2026-09-30");
    expect(stepDate("week", "2026-10-25", 1)).toBe("2026-11-01");
    expect(stepDate("week", "2026-10-25", -1)).toBe("2026-10-18");
    expect(stepDate("month", "2026-10-26", 1)).toBe("2026-11-26");
    expect(stepDate("month", "2026-12-15", 1)).toBe("2027-01-15");
    expect(stepDate("month", "2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("Range arithmetic", () => {
  it("panamaMidnight is 05:00Z with no DST", () => {
    expect(iso(panamaMidnight("2031-03-10"))).toBe("2031-03-10T05:00:00.000Z");
  });

  it("day and combined are the half-open selected Panama day", () => {
    for (const view of ["day", "combined"] as const) {
      const { from, to } = rangeFor(view, "2026-10-26");
      expect(iso(from)).toBe("2026-10-26T05:00:00.000Z");
      expect(iso(to)).toBe("2026-10-27T05:00:00.000Z");
    }
  });

  it("rolls over the year in the week view", () => {
    const { from, to } = rangeFor("week", "2026-12-31");
    expect(iso(from)).toBe("2026-12-28T05:00:00.000Z");
    expect(iso(to)).toBe("2027-01-04T05:00:00.000Z");
  });

  it("handles a leap day", () => {
    const { from, to } = rangeFor("day", "2028-02-29");
    expect(iso(from)).toBe("2028-02-29T05:00:00.000Z");
    expect(iso(to)).toBe("2028-03-01T05:00:00.000Z");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("month covers every drawn week, leading and trailing days included", () => {
    // October 2026 starts on a Thursday: the grid opens on Monday 2026-09-28 and ends on Sunday 2026-11-01.
    const { from, to } = rangeFor("month", "2026-10-15");
    expect(iso(from)).toBe("2026-09-28T05:00:00.000Z");
    expect(iso(to)).toBe("2026-11-02T05:00:00.000Z");
    expect(iso(rangeFor("month", "2028-02-10").from)).toBe("2028-01-31T05:00:00.000Z");
    expect(iso(rangeFor("month", "2026-12-10").to)).toBe("2027-01-04T05:00:00.000Z");
  });

  it("monthGrid is Monday-first with 4 to 6 rows", () => {
    const feb2027 = monthGrid("2027-02-10");
    expect(feb2027).toHaveLength(4);
    expect(feb2027[0][0]).toBe("2027-02-01");
    expect(feb2027[3][6]).toBe("2027-02-28");

    // October 2023 starts on a Sunday and has 31 days: six week rows.
    const oct2023 = monthGrid("2023-10-10");
    expect(oct2023).toHaveLength(6);
    expect(oct2023[0][0]).toBe("2023-09-25");
    expect(oct2023[5][6]).toBe("2023-11-05");
    for (const row of oct2023) expect(row).toHaveLength(7);
  });
});

describe("Vencida rule", () => {
  const now = new Date("2026-10-26T20:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  it("the margin is a single constant of 60 minutes", () => {
    expect(OVERDUE_MARGIN_MINUTES).toBe(60);
  });

  it("Margin boundary: false at 59 and exactly 60 minutes, true at 61", () => {
    expect(isOverdue("booked", ago(59), now)).toBe(false);
    expect(isOverdue("booked", ago(60), now)).toBe(false);
    expect(isOverdue("booked", ago(61), now)).toBe(true);
  });

  it("a future appointment is not overdue", () => {
    expect(isOverdue("booked", new Date(now.getTime() + 60_000), now)).toBe(false);
  });

  it.each(["open", "diagnosing", "in_progress", "on_hold", "ready_for_review", "done", "cancelled"] as const)(
    "a %s order is never overdue, however old",
    (status) => {
      expect(isOverdue(status, ago(60 * 24 * 40), now)).toBe(false);
    },
  );
});

describe("Time text identical on server and client", () => {
  it("formats 2026-10-26T19:05:00Z as 14:05 Panama time", () => {
    expect(formatAgendaTime("2026-10-26T19:05:00Z")).toBe("14:05");
  });

  it("midnight reads 00:00, never 24:00 or a 12-hour form", () => {
    expect(formatAgendaTime("2026-10-26T05:00:00Z")).toBe("00:00");
    expect(formatAgendaTime("2026-10-27T04:59:00Z")).toBe("23:59");
  });

  it("emits ASCII digits and a colon only", () => {
    expect(formatAgendaTime("2026-10-26T17:07:00Z")).toMatch(/^[0-9]{2}:[0-9]{2}$/);
  });
});
