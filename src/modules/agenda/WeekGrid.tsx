/**
 * agenda/WeekGrid.tsx - seven Monday-first day columns over one shared hour window. A plain component (no
 * "use client", no server imports), like DayGrid. Lanes cap at 2 per day: cards beyond that are not drawn and
 * the day gets a single "+N" link to its day view.
 */
import Link from "next/link";

import { AgendaCard } from "@/modules/agenda/AgendaCard";
import { WEEKDAY_SHORT } from "@/modules/agenda/dates";
import { clockLabel, hourWindow, nowLineTop, ROW, slotLabel, top } from "@/modules/agenda/grid";
import { layoutDay, type AgendaItem } from "@/modules/agenda/items";

const MAX_LANES = 2;

type Props = {
  /** The seven Panama day keys, Monday first. */
  days: readonly string[];
  items: readonly AgendaItem[];
  todayKey?: string;
  nowMinute?: number;
  selectedId?: string | null;
  onSelect?: (item: AgendaItem) => void;
  onSlot?: (day: string, time: string) => void;
};

export function WeekGrid({ days, items, todayKey, nowMinute, selectedId = null, onSelect, onSlot }: Props) {
  const [start, end] = hourWindow(items);
  const hours = Array.from({ length: end - start }, (_, i) => start + i);
  const columns = "grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]";
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className={`${columns} border-b border-border`}>
        <div />
        {days.map((day, i) => {
          const count = items.filter((it) => it.dayKey === day).length;
          return (
            <div key={day} data-day-header={day} data-weekend={i >= 5 ? "" : undefined} className={`border-l border-border px-2 py-2 ${day === todayKey ? "bg-muted" : ""}`}>
              <div data-weekday className="text-[11px] font-semibold tracking-wide text-muted-foreground">{WEEKDAY_SHORT[i]}</div>
              <div className="flex items-baseline gap-1">
                <span data-day-number className="text-xl font-bold">{Number(day.slice(8))}</span>
                {day === todayKey ? <span className="rounded-full bg-foreground px-1.5 text-[10px] font-semibold text-background">Hoy</span> : null}
                {count > 0 ? <span data-day-count className="ml-auto text-[11px] text-muted-foreground">{count}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className={columns}>
        <div className="relative" style={{ height: hours.length * ROW }}>
          {hours.map((h) => (
            <span key={h} className="absolute right-2 text-[11px] text-muted-foreground" style={{ top: top(h * 60, start) + 4 }}>{clockLabel(h * 60)}</span>
          ))}
        </div>
        {days.map((day, i) => {
          const dayItems = items.filter((it) => it.dayKey === day);
          const taken = new Set(dayItems.map((it) => Math.floor(it.minuteOfDay / 60)));
          const laid = layoutDay(dayItems);
          const hidden = laid.filter((l) => l.lane >= MAX_LANES);
          const now = nowMinute === undefined ? null : nowLineTop(nowMinute, day === todayKey, [start, end]);
          return (
            <div
              key={day}
              data-day-column={day}
              data-weekend={i >= 5 ? "" : undefined}
              className={`relative border-l border-border ${i >= 5 ? "agenda-hatch" : ""} ${day === todayKey ? "bg-muted/40" : ""}`}
              style={{ height: hours.length * ROW }}
            >
              {hours.map((h) => {
                const label = clockLabel(h * 60);
                return (
                  <div key={h} className="absolute inset-x-0 border-t border-border" style={{ top: top(h * 60, start), height: ROW }}>
                    {onSlot && !taken.has(h) ? (
                      <button type="button" aria-label={slotLabel(day, label)} onClick={() => onSlot(day, label)} className="absolute inset-0 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring" />
                    ) : null}
                  </div>
                );
              })}
              {/* The cards stop short of the "+N" gutter, so the link never covers card text. */}
              <div className={`absolute inset-y-0 left-0 ${hidden.length > 0 ? "right-11" : "right-0"}`}>
                {laid
                  .filter((l) => l.lane < MAX_LANES)
                  .map(({ item, lane, lanes }) => {
                    const shown = Math.min(lanes, MAX_LANES);
                    return (
                      <div key={item.id} className="absolute p-1" style={{ top: top(item.minuteOfDay, start), height: ROW, left: `${(lane / shown) * 100}%`, width: `${100 / shown}%` }}>
                        <AgendaCard item={item} selected={item.id === selectedId} onSelect={onSelect} />
                      </div>
                    );
                  })}
              </div>
              {/* shortcut: one link per day, placed at its first hidden card, even when two separate clusters overflow; split per cluster if that ever shows up in real data */}
              {hidden.length > 0 ? (
                <Link
                  href={`/agenda?view=day&date=${day}`}
                  aria-label={`+${hidden.length} más`}
                  className="absolute right-0 z-10 grid min-h-11 min-w-11 place-items-center rounded-lg border border-border bg-card text-xs font-semibold shadow-sm"
                  style={{ top: top(hidden[0].item.minuteOfDay, start) + 4 }}
                >
                  +{hidden.length}
                </Link>
              ) : null}
              {now !== null ? (
                <div data-now-line className="absolute inset-x-0 z-10 flex items-center" style={{ top: now }}>
                  <span className="absolute left-0 rounded bg-red-500 px-1 text-[10px] font-semibold text-white">{clockLabel(nowMinute!)}</span>
                  <span className="-ml-1 size-2.5 rounded-full bg-red-500" />
                  <span className="h-0.5 flex-1 bg-red-500" />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
