import { describe, expect, it } from "vitest";

import { fillBacklog, fillMonths, minutesToHours, shapeTechnicianMonth } from "./shape";

describe("fillMonths", () => {
  it("zero-fills a month with no rows against the key list", () => {
    expect(fillMonths(["2026-06", "2026-07", "2026-08"], [{ mes: "2026-06", n: 3 }, { mes: "2026-08", n: 1 }])).toEqual([
      { key: "2026-06", value: 3 },
      { key: "2026-07", value: 0 },
      { key: "2026-08", value: 1 },
    ]);
  });

  it("ignores rows outside the key list", () => {
    expect(fillMonths(["2026-08"], [{ mes: "2025-01", n: 9 }])).toEqual([{ key: "2026-08", value: 0 }]);
  });
});

describe("minutesToHours", () => {
  it("converts 270 minutes to 4.5 hours", () => {
    expect(minutesToHours(270)).toBe(4.5);
  });

  it("rounds to two decimals", () => {
    expect(minutesToHours(100)).toBe(1.67);
  });
});

describe("fillBacklog", () => {
  it("returns all three statuses with 0 for the missing ones", () => {
    expect(fillBacklog([{ status: "in_progress", n: 2 }])).toEqual({ open: 0, in_progress: 2, ready_for_review: 0 });
  });

  it("ignores statuses outside the backlog", () => {
    expect(fillBacklog([{ status: "done", n: 5 }])).toEqual({ open: 0, in_progress: 0, ready_for_review: 0 });
  });
});

describe("shapeTechnicianMonth", () => {
  const roster = [
    { id: "a", nombre: "Ana", active: true },
    { id: "b", nombre: "Beto", active: true },
    { id: "c", nombre: "Carlos", active: false },
    { id: "d", nombre: "Dora", active: false },
  ];

  it("joins closed and hours per technician for the month", () => {
    const rows = shapeTechnicianMonth({
      roster: roster.slice(0, 1),
      closed: [{ tecnicoId: "a", mes: "2026-09", n: 3 }, { tecnicoId: "a", mes: "2026-08", n: 7 }],
      minutes: [{ tecnicoId: "a", mes: "2026-09", n: 270 }],
      mes: "2026-09",
    });
    expect(rows).toEqual([{ tecnicoId: "a", nombre: "Ana", closed: 3, hours: 4.5 }]);
  });

  it("keeps an active technician with no numbers and drops an inactive one", () => {
    const rows = shapeTechnicianMonth({
      roster,
      closed: [{ tecnicoId: "c", mes: "2026-09", n: 1 }],
      minutes: [],
      mes: "2026-09",
    });
    expect(rows.map((r) => r.tecnicoId)).toEqual(["a", "b", "c"]);
  });

  it("credits every assignee of a shared order", () => {
    const rows = shapeTechnicianMonth({
      roster: roster.slice(0, 2),
      closed: [{ tecnicoId: "a", mes: "2026-09", n: 1 }, { tecnicoId: "b", mes: "2026-09", n: 1 }],
      minutes: [],
      mes: "2026-09",
    });
    expect(rows.map((r) => r.closed)).toEqual([1, 1]);
    // the order total is a separate query and stays 1: closedByMonth, not the sum of this column
  });
});
