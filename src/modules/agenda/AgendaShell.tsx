"use client";

/**
 * agenda/AgendaShell.tsx - the one client component of the agenda page: it owns the selected card and renders the
 * view and the selected appointment's Detail. The page hands it plain data only (no function, no `Date`); the card
 * callbacks are created here, so no function ever crosses the Server Component boundary.
 */
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AgendaDetail } from "@/modules/agenda/AgendaDetail";
import { AgendaTabs, type TabKey } from "@/modules/agenda/AgendaTabs";

import { CombinedView } from "@/modules/agenda/CombinedView";
import { addDays, weekStart, type AgendaView } from "@/modules/agenda/dates";
import { DayGrid } from "@/modules/agenda/DayGrid";
import { filterItems, type AgendaItem, type WorkshopItem } from "@/modules/agenda/items";
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
  /** Active technicians for "+ Asignar técnico"; null when the user may not assign. */
  roster: { id: string; nombre: string }[] | null;
  /** The true number of Vencida orders, whatever the range or the search. */
  overdueTotal: number;
};

export function AgendaShell({ view, date, today, nowMinute, items, workshop, workshopTruncated, roster, overdueTotal }: Props) {
  const [tab, setTab] = useState<TabKey>("todas");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<{ id: string; anchor: HTMLElement; wide: boolean } | null>(null);
  // The width is read here, in the click, never while rendering: a render-time read differs between the server and
  // the browser (hydration), and the Detail only ever opens from a click.
  const select = (item: AgendaItem, anchor: HTMLElement) =>
    setOpen({ id: item.id, anchor, wide: window.matchMedia("(min-width: 768px)").matches });
  const close = () => setOpen(null);
  // Shortcut: until the Vencidas list (its own unit) lands, that tab shows the calendar like "Todas".
  const visible = filterItems(items, tab === "agendadas" ? "agendadas" : "todas", search);
  const selected = view === "month" || !open ? undefined : visible.find((i) => i.id === open.id);
  const grid = { todayKey: today, nowMinute, selectedId: selected?.id ?? null, onSelect: select };
  return (
    <div className="flex flex-col gap-3">
      <Input type="search" aria-label="Buscar" placeholder="Buscar placa o cliente…" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-64" />
      <AgendaTabs tab={tab} agendadas={filterItems(items, "agendadas", search).length} vencidas={overdueTotal} onTab={setTab} />
      {visible.length === 0 && (items.length > 0 || search !== "") ? <p role="status" className="text-sm text-muted-foreground">Sin resultados</p> : null}
      {view === "month" ? (
        <MonthView date={date} today={today} items={visible} />
      ) : view === "week" ? (
        <WeekGrid days={Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i))} items={visible} {...grid} />
      ) : view === "combined" ? (
        <CombinedView date={date} items={visible} workshop={workshop ?? []} workshopTruncated={workshopTruncated} {...grid} />
      ) : (
        <DayGrid date={date} items={visible} {...grid} />
      )}
      {selected && open?.wide ? (
        <Popover open onOpenChange={(next) => !next && close()}>
          <PopoverContent anchor={open.anchor} aria-label="Detalle de la cita">
            <AgendaDetail key={selected.id} item={selected} roster={roster} onClose={close} />
          </PopoverContent>
        </Popover>
      ) : null}
      {selected && !open?.wide ? (
        <Sheet open onOpenChange={(next) => !next && close()}>
          <SheetContent side="bottom" showCloseButton={false} aria-label="Detalle de la cita" className="p-4">
            <AgendaDetail key={selected.id} item={selected} roster={roster} onClose={close} />
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
