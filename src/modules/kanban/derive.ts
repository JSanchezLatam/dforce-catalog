/**
 * kanban/derive.ts - KPIs and filter counts, pure. "Today" is the Panama calendar day of the
 * snapshot's own `generatedAt`, never the clock, so a server render and a poll agree and a test
 * needs no fake timers. KPIs are always taken over the FULL set; a filter only narrows the cards.
 */
import { toWorkshopDateKey } from "@/shared/datetime";
import type { KanbanCard } from "./shape";

export type KanbanFilter = "all" | "mine" | "urgent" | "on_hold";

const IN_SHOP = ["open", "diagnosing", "in_progress", "on_hold", "ready_for_review"];
const day = (iso: string) => toWorkshopDateKey(new Date(iso));

export function deriveBoard(rows: KanbanCard[], generatedAt: string) {
  const today = day(generatedAt);
  const count = (pred: (c: KanbanCard) => boolean) => rows.filter(pred).length;
  const bookedAt = (c: KanbanCard) => (c.status === "booked" && c.appointmentAt ? c.appointmentAt : null);
  return {
    kpis: {
      inShop: count((c) => IN_SHOP.includes(c.status)),
      urgent: count((c) => c.urgent),
      onHold: count((c) => c.status === "on_hold"),
      // `statusSince` of a done card is when it completed (its latest history row).
      doneToday: count((c) => c.status === "done" && day(c.statusSince) === today),
      bookedToday: count((c) => bookedAt(c) !== null && day(bookedAt(c)!) === today),
      overdue: count((c) => bookedAt(c) !== null && Date.parse(bookedAt(c)!) < Date.parse(generatedAt)),
    },
    counts: {
      all: rows.length,
      mine: count((c) => c.mine),
      urgent: count((c) => c.urgent),
      on_hold: count((c) => c.status === "on_hold"),
    } satisfies Record<KanbanFilter, number>,
  };
}

const FILTERS: Record<KanbanFilter, (c: KanbanCard) => boolean> = {
  all: () => true,
  mine: (c) => c.mine,
  urgent: (c) => c.urgent,
  on_hold: (c) => c.status === "on_hold",
};

export const filterCards = (rows: KanbanCard[], filter: KanbanFilter): KanbanCard[] => rows.filter(FILTERS[filter]);
