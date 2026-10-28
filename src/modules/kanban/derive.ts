/**
 * kanban/derive.ts - KPIs and filter counts, pure. "Today" is the Panama calendar day of the
 * snapshot's own `generatedAt`, never the clock, so a server render and a poll agree and a test
 * needs no fake timers. KPIs are always taken over the FULL set; a filter only narrows the cards.
 */
import { formatAge, formatBoardTime } from "@/modules/board/format";
import { toWorkshopDateKey } from "@/shared/datetime";
import type { KanbanCard } from "./shape";

export type KanbanFilter = "all" | "mine" | "urgent" | "on_hold";

const IN_SHOP = ["open", "diagnosing", "in_progress", "on_hold", "ready_for_review"];
const day = (iso: string) => toWorkshopDateKey(new Date(iso));

/** The kanban card says "1 día"; the TV boards keep `formatAge`'s "1 d" (their tests pin it). */
export function ageLabel(since: string, now: string): string {
  const age = formatAge(since, now);
  const days = /^(\d+) d$/.exec(age)?.[1];
  return days ? `${days} ${days === "1" ? "día" : "días"}` : age;
}

const clock = (iso: string) => formatBoardTime(iso).slice(-5); // "dd/mm HH:MM" -> "HH:MM"
const ms = Date.parse;

export function deriveBoard(rows: KanbanCard[], generatedAt: string) {
  const today = day(generatedAt);
  const count = (pred: (c: KanbanCard) => boolean) => rows.filter(pred).length;
  const bookedAt = (c: KanbanCard) => (c.status === "booked" && c.appointmentAt ? c.appointmentAt : null);
  const earliest = (isos: string[]) => isos.reduce<string | null>((a, b) => (a === null || ms(b) < ms(a) ? b : a), null);
  const latest = (isos: string[]) => isos.reduce<string | null>((a, b) => (a === null || ms(b) > ms(a) ? b : a), null);
  const booked = rows.flatMap((c) => bookedAt(c) ?? []);
  const doneIso = latest(rows.filter((c) => c.status === "done" && day(c.statusSince) === today).map((c) => c.statusSince));
  const nextIso = earliest(booked.filter((a) => day(a) === today && ms(a) >= ms(generatedAt)));
  const overdueIso = earliest(booked.filter((a) => ms(a) < ms(generatedAt)));
  const states = new Set(rows.filter((c) => IN_SHOP.includes(c.status)).map((c) => c.status)).size;
  const reasons = [...new Set(rows.flatMap((c) => (c.status === "on_hold" && c.holdReason ? c.holdReason.toLowerCase() : [])))];
  return {
    // One short line under each KPI value, `null` when there is nothing to say. Times are Panama clock.
    subs: {
      inShop: states ? `en ${states} ${states === 1 ? "estado" : "estados"}` : null,
      urgent: "marcadas a mano",
      onHold: reasons.length ? reasons.join(" y ") : null,
      doneToday: doneIso && `última ${clock(doneIso)}`,
      bookedToday: nextIso && `próxima ${clock(nextIso)}`,
      // An overdue appointment from an earlier day carries its date, or "desde 15:00" would read as today.
      overdue: overdueIso && `desde ${day(overdueIso) === today ? clock(overdueIso) : formatBoardTime(overdueIso)}`,
    },
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
