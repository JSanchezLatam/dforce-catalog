import { describe, expect, it } from "vitest";

import { compareInColumn } from "./sort";

const card = (urgent: boolean, statusSince: string) => ({ urgent, statusSince });
const OLD = "2026-10-26T08:00:00.000Z";
const NEW = "2026-10-26T14:00:00.000Z";

describe("compareInColumn()", () => {
  it("puts an urgent card before a non-urgent one even when the non-urgent one is older", () => {
    const rows = [card(false, OLD), card(true, NEW)];

    expect(rows.sort(compareInColumn).map((r) => r.urgent)).toEqual([true, false]);
  });

  it("orders cards of the same urgency by longest time in status first", () => {
    const rows = [card(false, NEW), card(false, OLD)];

    expect(rows.sort(compareInColumn).map((r) => r.statusSince)).toEqual([OLD, NEW]);
  });

  it("keeps the longest-first order inside the urgent group too", () => {
    const rows = [card(true, NEW), card(true, OLD)];

    expect(rows.sort(compareInColumn).map((r) => r.statusSince)).toEqual([OLD, NEW]);
  });
});
