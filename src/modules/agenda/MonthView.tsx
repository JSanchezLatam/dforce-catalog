import Link from "next/link";

import { cn } from "@/lib/utils";
import { StatusIcon, statusText } from "@/modules/agenda/AgendaCard";
import { monthGrid, WEEKDAY_SHORT } from "@/modules/agenda/dates";
import { groupByDay, type AgendaItem } from "@/modules/agenda/items";

const CARDS_PER_CELL = 3;
const TARGET = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-sm hover:bg-muted";

/** The plate, or the customer's first name when there is no vehicle: all a month card has room for. */
const tag = (item: AgendaItem) => (item.vehicleLabel === "Sin vehículo" ? item.customerName.split(" ")[0] : item.vehicleLabel.split(" · ")[0]);

function MonthCard({ item, selected, onSelect }: { item: AgendaItem; selected: boolean; onSelect?: (item: AgendaItem, anchor: HTMLElement) => void }) {
  const status = statusText(item);
  return (
    <button
      type="button"
      data-categoria={item.categoria ?? "none"}
      aria-pressed={selected}
      aria-label={[`${item.time} ${tag(item)}`, item.categoriaLabel, status].filter(Boolean).join(", ")}
      onClick={(event) => onSelect?.(item, event.currentTarget)}
      className={cn(
        "agenda-ev flex min-h-11 w-full min-w-11 items-center gap-1 overflow-hidden rounded-md px-1.5 py-1 text-left text-[11px] font-semibold",
        item.noShow ? "opacity-45" : item.muted && "opacity-60",
        selected ? "ring-2 ring-foreground" : item.overdue && "ring-2 ring-destructive",
      )}
    >
      <StatusIcon item={item} />
      <span className="truncate">{`${item.time} ${tag(item)}`}</span>
    </button>
  );
}

/**
 * Monday-first grid of the weeks the month draws. From `md` a cell shows its first three cards by time and a
 * "+N más" link to the day view; below it the cells are too narrow, so they collapse to a count (CSS only) and the
 * day number still opens the day. `onSelect` / `onSlot` exist only when the caller passes them (the shell does).
 */
export function MonthView({ date, today, items, selectedId = null, onSelect, onSlot }: { date: string; today: string; items: readonly AgendaItem[]; selectedId?: string | null; onSelect?: (item: AgendaItem, anchor: HTMLElement) => void; onSlot?: (day: string) => void }) {
  const byDay = groupByDay(items);
  const month = date.slice(0, 7);
  return (
    <div className="grid grid-cols-7 gap-1">
      {WEEKDAY_SHORT.map((name) => (
        <div key={name} className="px-1 text-center text-xs font-semibold text-muted-foreground">
          {name}
        </div>
      ))}
      {monthGrid(date)
        .flat()
        .map((key, index) => {
          const weekend = index % 7 >= 5;
          const dayItems = byDay.get(key) ?? [];
          const hidden = dayItems.length - CARDS_PER_CELL;
          return (
            <div key={key} data-testid={`cell-${key}`} data-weekend={weekend ? "" : undefined} className={cn("flex min-h-11 min-w-11 flex-col gap-1 rounded-md border p-1", weekend && "agenda-hatch", !key.startsWith(month) && "opacity-50")}>
              <div className="flex flex-wrap items-center justify-between">
              <Link
                href={`/agenda?view=day&date=${key}`}
                aria-current={key === today ? "date" : undefined}
                className={cn(TARGET, "font-semibold", key === today && "bg-primary text-primary-foreground hover:bg-primary")}
              >
                {Number(key.slice(8))}
              </Link>
              {onSlot ? (
                <button type="button" aria-label={`Nueva cita el ${key.slice(8)}/${key.slice(5, 7)}`} onClick={() => onSlot(key)} className={TARGET}>
                  +
                </button>
              ) : null}
              </div>
              {dayItems.length > 0 ? (
                <span className="self-start text-xs text-muted-foreground md:hidden">
                  <span aria-hidden="true" className="rounded-full bg-muted px-2 py-0.5 font-semibold">{dayItems.length}</span>
                  <span className="sr-only">{dayItems.length} {dayItems.length === 1 ? "cita" : "citas"}</span>
                </span>
              ) : null}
              <ul className="flex flex-col gap-1 max-md:hidden">
                {dayItems.slice(0, CARDS_PER_CELL).map((item) => (
                  <li key={item.id} className="flex flex-col gap-1">
                    <MonthCard item={item} selected={item.id === selectedId} onSelect={onSelect} />
                  </li>
                ))}
              </ul>
              {hidden > 0 ? (
                <Link href={`/agenda?view=day&date=${key}`} className={cn(TARGET, "max-md:hidden")}>
                  +{hidden} más
                </Link>
              ) : null}
            </div>
          );
        })}
    </div>
  );
}
