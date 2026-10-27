"use client";

/**
 * agenda/AgendaShell.tsx - the one client component of the agenda page: it owns the selected card and renders the
 * view and the selected appointment's Detail. The page hands it plain data only (no function, no `Date`); the card
 * callbacks are created here, so no function ever crosses the Server Component boundary.
 */
import { useState } from "react";

import { Popover, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AgendaDetail } from "@/modules/agenda/AgendaDetail";

import { CombinedView } from "@/modules/agenda/CombinedView";
import { addDays, weekStart, type AgendaView } from "@/modules/agenda/dates";
import { DayGrid } from "@/modules/agenda/DayGrid";
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
  const [open, setOpen] = useState<{ id: string; anchor: HTMLElement; wide: boolean } | null>(null);
  // The width is read here, in the click, never while rendering: a render-time read differs between the server and
  // the browser (hydration), and the Detail only ever opens from a click.
  const select = (item: AgendaItem, anchor: HTMLElement) =>
    setOpen({ id: item.id, anchor, wide: window.matchMedia("(min-width: 768px)").matches });
  const close = () => setOpen(null);
  const selected = view === "month" || !open ? undefined : items.find((i) => i.id === open.id);
  const grid = { todayKey: today, nowMinute, selectedId: selected?.id ?? null, onSelect: select };
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
      {selected && open?.wide ? (
        <Popover open onOpenChange={(next) => !next && close()}>
          <PopoverContent anchor={open.anchor} aria-label="Detalle de la cita">
            <AgendaDetail key={selected.id} item={selected} onClose={close} />
          </PopoverContent>
        </Popover>
      ) : null}
      {selected && !open?.wide ? (
        <Sheet open onOpenChange={(next) => !next && close()}>
          <SheetContent side="bottom" showCloseButton={false} aria-label="Detalle de la cita" className="p-4">
            <AgendaDetail key={selected.id} item={selected} onClose={close} />
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
