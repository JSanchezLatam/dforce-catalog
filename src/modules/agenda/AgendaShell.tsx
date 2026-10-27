"use client";

/**
 * agenda/AgendaShell.tsx - the one client component of the agenda page: it owns the selected card and renders the
 * view. The page hands it plain data only (no function, no `Date`); the card callbacks are created here, so no
 * function ever crosses the Server Component boundary.
 */
import { useState } from "react";
import Link from "next/link";

import { CombinedView } from "@/modules/agenda/CombinedView";
import { addDays, weekStart, type AgendaView } from "@/modules/agenda/dates";
import { DayGrid } from "@/modules/agenda/DayGrid";
import { ItemActions } from "@/modules/agenda/ItemActions";
import type { AgendaItem, WorkshopItem } from "@/modules/agenda/items";
import { MonthView } from "@/modules/agenda/MonthView";
import { WeekGrid } from "@/modules/agenda/WeekGrid";

type Props = {
  view: AgendaView;
  date: string;
  /** Today's Panama day and the minute of day, both from the page's one `now`. */
  today: string;
  nowMinute: number;
  items: readonly AgendaItem[];
  /** Only the combined view reads the workshop. */
  workshop: readonly WorkshopItem[] | null;
  workshopTruncated: boolean;
};

export function AgendaShell({ view, date, today, nowMinute, items, workshop, workshopTruncated }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const select = (item: AgendaItem) => setSelectedId((current) => (current === item.id ? null : item.id));
  const selected = view === "month" ? undefined : items.find((i) => i.id === selectedId);
  const grid = { todayKey: today, nowMinute, selectedId, onSelect: select };
  return (
    <div className="flex flex-col gap-3">
      {view === "month" ? (
        <MonthView date={date} today={today} items={items} />
      ) : view === "week" ? (
        <WeekGrid days={Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i))} items={items} {...grid} />
      ) : view === "combined" ? (
        <CombinedView date={date} items={items} workshop={workshop ?? []} workshopTruncated={workshopTruncated} {...grid} />
      ) : (
        <DayGrid date={date} items={items} {...grid} />
      )}
      {/* Stand-in for the Detail (a later unit): a card is a button now, so the order link and the two actions live here. */}
      {selected ? (
        <section aria-label="Cita seleccionada" className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-3">
          <span className="text-sm font-medium">
            {selected.time} · {selected.customerName}
          </span>
          <Link href={selected.href} className="inline-flex min-h-11 min-w-11 items-center rounded-md border px-3 text-sm hover:bg-muted">
            Abrir orden
          </Link>
          <ItemActions item={selected} />
        </section>
      ) : null}
    </div>
  );
}
