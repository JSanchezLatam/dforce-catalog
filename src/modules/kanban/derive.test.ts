import { describe, expect, it, vi } from "vitest";

import type { OrderStatus } from "@/modules/service-orders/transitions";
import { ageLabel, deriveBoard, filterCards, type KanbanFilter } from "./derive";
import type { KanbanCard } from "./shape";

// 09:00 on 2026-10-27 in Panama (UTC-5).
const NOW = "2026-10-27T14:00:00.000Z";

const card = (status: OrderStatus, extra: Partial<KanbanCard> = {}): KanbanCard => ({
  id: `${status}-${Math.random()}`,
  status,
  statusLabel: status,
  plate: "AB1234",
  make: "Toyota",
  model: "Hilux",
  holdReason: null,
  technicians: [],
  statusSince: "2026-10-27T13:00:00.000Z",
  urgent: false,
  categoria: "revisado",
  missing: [],
  mine: false,
  ...extra,
});
const booked = (appointmentAt: string | null) => card("booked", { appointmentAt });

describe("deriveBoard()", () => {
  it("counts the six KPIs from the displayed cards", () => {
    const rows = [
      card("open"),
      card("diagnosing"),
      card("in_progress", { urgent: true }),
      card("on_hold", { urgent: true }),
      card("ready_for_review"),
      card("done", { statusSince: "2026-10-27T13:00:00.000Z" }),
      booked("2026-10-27T20:00:00.000Z"), // today, still ahead
      booked("2026-10-27T12:00:00.000Z"), // today, already passed
      booked("2026-10-26T20:00:00.000Z"), // yesterday: passed, not "today"
      booked(null),
    ];

    expect(deriveBoard(rows, NOW).kpis).toEqual({ inShop: 5, urgent: 2, onHold: 1, doneToday: 1, bookedToday: 2, overdue: 2 });
  });

  it("decides 'today' in Panama from generatedAt, not from the clock or the server zone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-01-01T00:00:00.000Z"));
    try {
      // 02:00 UTC on the 28th is still the 27th in Panama.
      const lateNow = "2026-10-28T02:00:00.000Z";
      const rows = [booked("2026-10-27T20:00:00.000Z"), booked("2026-10-28T20:00:00.000Z"), card("done", { statusSince: "2026-10-27T15:00:00.000Z" })];

      expect(deriveBoard(rows, lateNow).kpis).toMatchObject({ bookedToday: 1, doneToday: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts a done card from yesterday in Panama as not completed today", () => {
    const rows = [card("done", { statusSince: "2026-10-27T04:30:00.000Z" })]; // 23:30 on the 26th in Panama

    expect(deriveBoard(rows, NOW).kpis.doneToday).toBe(0);
  });

  it("filter counts match the filters", () => {
    const rows = [card("open", { mine: true }), card("in_progress", { urgent: true, mine: true }), card("on_hold"), card("done")];

    expect(deriveBoard(rows, NOW).counts).toEqual({ all: 4, mine: 2, urgent: 1, on_hold: 1 });
  });
});

describe("filterCards()", () => {
  const rows = [card("open", { mine: true }), card("in_progress", { urgent: true }), card("on_hold")];

  it.each([
    ["all", 3],
    ["mine", 1],
    ["urgent", 1],
    ["on_hold", 1],
  ] as [KanbanFilter, number][])("%s keeps %i card(s)", (filter, count) => {
    expect(filterCards(rows, filter)).toHaveLength(count);
  });
});

describe("deriveBoard() sub-captions", () => {
  const subs = (rows: KanbanCard[]) => deriveBoard(rows, NOW).subs;

  it("counts distinct in-shop states, singular for one, nothing for none", () => {
    expect(subs([card("open"), card("open"), card("diagnosing"), card("booked")]).inShop).toBe("en 2 estados");
    expect(subs([card("open"), card("open")]).inShop).toBe("en 1 estado");
    expect(subs([card("booked")]).inShop).toBeNull();
  });

  it("names the distinct hold reasons, lower-cased, and ignores a card with none", () => {
    const hold = (holdReason: string | null) => card("on_hold", { holdReason });
    expect(subs([hold("Repuesto"), hold("Aprobación del cliente"), hold("Repuesto")]).onHold).toBe("repuesto y aprobación del cliente");
    expect(subs([hold(null)]).onHold).toBeNull();
    expect(subs([card("open")]).onHold).toBeNull();
  });

  it("gives the latest completion today, the next appointment still ahead and the oldest overdue, in Panama time", () => {
    const rows = [
      card("done", { statusSince: "2026-10-27T13:15:00.000Z" }), // 08:15
      card("done", { statusSince: "2026-10-27T14:00:00.000Z" }), // 09:00
      card("done", { statusSince: "2026-10-26T20:00:00.000Z" }), // yesterday, ignored
      booked("2026-10-27T20:30:00.000Z"), // 15:30, ahead
      booked("2026-10-27T16:00:00.000Z"), // 11:00, the next one
      booked("2026-10-27T12:00:00.000Z"), // 07:00, overdue
      booked("2026-10-27T13:30:00.000Z"), // 08:30, overdue
    ];
    expect(subs(rows)).toMatchObject({ doneToday: "última 09:00", bookedToday: "próxima 11:00", overdue: "desde 07:00" });
  });

  it("dates an overdue appointment from an earlier day, and has no caption without data", () => {
    expect(subs([booked("2026-10-26T20:00:00.000Z")]).overdue).toBe("desde 26/10 15:00");
    expect(subs([card("open")])).toMatchObject({ doneToday: null, bookedToday: null, overdue: null });
  });
});

describe("ageLabel()", () => {
  it("spells days out, singular and plural, and leaves minutes and hours as the TV prints them", () => {
    const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();
    const MIN = 60_000;
    expect(ageLabel(ago(15 * MIN), NOW)).toBe("15 min");
    expect(ageLabel(ago(5 * 60 * MIN), NOW)).toBe("5 h");
    expect(ageLabel(ago(24 * 60 * MIN), NOW)).toBe("1 día");
    expect(ageLabel(ago(3 * 24 * 60 * MIN), NOW)).toBe("3 días");
  });
});
