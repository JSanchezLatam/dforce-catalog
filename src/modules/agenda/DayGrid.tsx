/**
 * agenda/DayGrid.tsx - one day as an hour grid. A plain component (no "use client", no server imports): the client
 * shell renders it with plain props. Times are digits only, never locale text. The slot controls and the card
 * activation exist only when the caller passes `onSlot` / `onSelect`.
 */
import { AgendaCard } from "@/modules/agenda/AgendaCard";
import { clockLabel, hourWindow, nowLineTop, ROW, top } from "@/modules/agenda/grid";
import { layoutDay, type AgendaItem } from "@/modules/agenda/items";

type Props = {
  /** Panama day, `YYYY-MM-DD`. */
  date: string;
  items: readonly AgendaItem[];
  /** Today's Panama day and the minute of day at render; the now-line needs both. */
  todayKey?: string;
  nowMinute?: number;
  selectedId?: string | null;
  onSelect?: (item: AgendaItem) => void;
  onSlot?: (day: string, time: string) => void;
};

export function DayGrid({ date, items, todayKey, nowMinute, selectedId = null, onSelect, onSlot }: Props) {
  const [start, end] = hourWindow(items);
  const hours = Array.from({ length: end - start }, (_, i) => start + i);
  const taken = new Set(items.map((i) => Math.floor(i.minuteOfDay / 60)));
  const now = nowMinute === undefined ? null : nowLineTop(nowMinute, todayKey === date, [start, end]);
  const [y, m, d] = date.split("-");
  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 ? <p className="text-sm text-muted-foreground">Sin citas para este día</p> : null}
      <div className="relative ml-14" style={{ height: hours.length * ROW }}>
        {hours.map((h) => {
          const label = clockLabel(h * 60);
          return (
            <div key={h} className="absolute inset-x-0 border-t border-border" style={{ top: top(h * 60, start), height: ROW }}>
              <span className="absolute -left-14 top-1 text-[11px] text-muted-foreground">{label}</span>
              {onSlot && !taken.has(h) ? (
                <button
                  type="button"
                  aria-label={`Nueva cita ${d}/${m}/${y} ${label}`}
                  onClick={() => onSlot(date, label)}
                  className="absolute inset-0 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                />
              ) : null}
            </div>
          );
        })}
        {layoutDay(items).map(({ item, lane, lanes }) => (
          <div
            key={item.id}
            className="absolute p-1"
            style={{ top: top(item.minuteOfDay, start), height: ROW, left: `${(lane / lanes) * 100}%`, width: `${100 / lanes}%` }}
          >
            <AgendaCard item={item} selected={item.id === selectedId} onSelect={onSelect} />
          </div>
        ))}
        {now !== null ? (
          <div data-now-line className="absolute inset-x-0 z-10 flex items-center" style={{ top: now }}>
            <span className="absolute -left-14 rounded bg-red-500 px-1 text-[10px] font-semibold text-white">{clockLabel(nowMinute!)}</span>
            <span className="-ml-1 size-2.5 rounded-full bg-red-500" />
            <span className="h-0.5 flex-1 bg-red-500" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
