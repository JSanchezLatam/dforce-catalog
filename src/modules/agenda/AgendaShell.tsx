"use client";

/**
 * agenda/AgendaShell.tsx - the one client component of the agenda page: it renders the header and owns the selected card and renders the
 * view and the selected appointment's Detail. The page hands it plain data only (no function, no `Date`); the card
 * callbacks are created here, so no function ever crosses the Server Component boundary.
 */
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AgendaBookingForm } from "@/modules/agenda/AgendaBookingForm";
import { AgendaDetail } from "@/modules/agenda/AgendaDetail";
import { AgendaHeader } from "@/modules/agenda/AgendaHeader";
import { MiniCalendar } from "@/modules/agenda/MiniCalendar";
import { NextCard } from "@/modules/agenda/NextCard";
import { AgendaSidebar } from "@/modules/agenda/AgendaSidebar";
import { AgendaTabs, type TabKey } from "@/modules/agenda/AgendaTabs";

import { CombinedView } from "@/modules/agenda/CombinedView";
import { addDays, weekStart, type AgendaView } from "@/modules/agenda/dates";
import { DayGrid } from "@/modules/agenda/DayGrid";
import { filterItems, typeCounts, type AgendaItem, type TypeKey, type WorkshopItem } from "@/modules/agenda/items";
import { VencidasList } from "@/modules/agenda/VencidasList";
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
  /** The capped Vencida list, oldest first. */
  overdue: readonly AgendaItem[];
  overdueTruncated: boolean;
  /** The range query hit its row cap: the header says so. */
  truncated: boolean;
  /** "Esta semana", from the page's own count query. */
  weekSummary: readonly { label: string; count: number }[];
  /** Panama days of the displayed month with an appointment. */
  busyDays: readonly string[];
  /** The earliest future booked appointment with its server-made "en 20 min" text; null when none. */
  next: { item: AgendaItem; label: string } | null;
};

export function AgendaShell({ view, date, today, nowMinute, items, workshop, workshopTruncated, roster, overdueTotal, overdue, overdueTruncated, truncated, weekSummary, busyDays, next }: Props) {
  const [tab, setTab] = useState<TabKey>("todas");
  const [search, setSearch] = useState("");
  const [hidden, setHidden] = useState<readonly TypeKey[]>([]);
  // The one "Nueva cita" dialog: the header button opens it on the selected date, an empty slot on its day and hour.
  const [booking, setBooking] = useState<{ day: string; time: string } | null>(null);
  const openBooking = (day: string, time = "") => setBooking({ day, time });
  const scope = `${view}|${date}`;
  const [open, setOpen] = useState<{ id: string; anchor: HTMLElement; wide: boolean; scope: string } | null>(null);
  // The width is read here, in the click, never while rendering: a render-time read differs between the server and
  // the browser (hydration), and the Detail only ever opens from a click.
  const select = (item: AgendaItem, anchor: HTMLElement) =>
    setOpen({ id: item.id, anchor, wide: window.matchMedia("(min-width: 768px)").matches, scope });
  const close = () => setOpen(null);
  const onVencidas = tab === "vencidas";
  const visible = filterItems(items, tab === "agendadas" ? "agendadas" : "todas", search, hidden);
  const overdueVisible = filterItems(overdue, "todas", search, hidden);
  // The Detail belongs to the view and date it opened in (`scope`): its anchor is a card element of that render, so
  // on any other the element is gone. Dropped in render (React's derived-state pattern) so coming back never reopens it.
  const selected = open?.scope === scope ? (onVencidas ? overdueVisible : visible).find((i) => i.id === open.id) : undefined;
  if (open && !selected) setOpen(null);
  const noMatch = visible.length === 0 && (items.length > 0 || search !== "");
  const grid = { todayKey: today, nowMinute, selectedId: selected?.id ?? null, onSelect: select, onSlot: openBooking };
  // The day grid and the combined view say it themselves; week and month get the paragraph, so a hidden day shows one message, never two.
  const emptyText = noMatch ? "Sin resultados" : undefined;
  return (
    <div className="flex flex-col gap-3">
      <AgendaHeader
        view={view}
        date={date}
        today={today}
        truncated={truncated}
        onNew={() => openBooking(date)}
        search={<Input type="search" aria-label="Buscar" placeholder="Buscar placa o cliente…" value={search} onChange={(e) => setSearch(e.target.value)} className="min-h-11 sm:w-64" />}
        tabs={<AgendaTabs tab={tab} agendadas={filterItems(items, "agendadas", search, hidden).length} vencidas={overdueTotal} onTab={setTab} />}
      />
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
        <AgendaSidebar
          counts={typeCounts(items)}
          hidden={hidden}
          summary={weekSummary}
          calendar={<MiniCalendar view={view} date={date} today={today} busyDays={busyDays} />}
          next={<NextCard next={next} />}
          onToggle={(key) => setHidden((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]))}
          onAll={() => setHidden([])}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
            {noMatch && !onVencidas && (view === "week" || view === "month") ? <p role="status" className="text-sm text-muted-foreground">Sin resultados</p> : null}
            {onVencidas ? (
              <VencidasList items={overdueVisible} empty={overdue.length === 0 ? "Sin citas vencidas" : "Sin resultados"} truncated={overdueTruncated} selectedId={selected?.id ?? null} onSelect={select} />
            ) : view === "month" ? (
              <MonthView date={date} today={today} items={visible} selectedId={grid.selectedId} onSelect={select} onSlot={openBooking} />
            ) : view === "week" ? (
              <WeekGrid days={Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i))} items={visible} {...grid} />
            ) : view === "combined" ? (
              <CombinedView date={date} items={visible} workshop={workshop ?? []} workshopTruncated={workshopTruncated} emptyText={emptyText} {...grid} />
            ) : (
              <DayGrid date={date} items={visible} emptyText={emptyText} {...grid} />
            )}
        </div>
      </div>
      <AgendaBookingForm open={booking !== null} onOpenChange={(next) => !next && setBooking(null)} day={booking?.day ?? date} time={booking?.time} />
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
