import Link from "next/link";

import { cn } from "@/lib/utils";
import { DayBooking } from "@/modules/agenda/AgendaBookingForm";
import { AgendaChip } from "@/modules/agenda/AgendaChip";
import { ItemActions } from "@/modules/agenda/ItemActions";
import { monthGrid, WEEKDAY_SHORT } from "@/modules/agenda/dates";
import { groupByDay, type AgendaItem } from "@/modules/agenda/items";

const CHIPS_PER_CELL = 3;
const TARGET = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-sm hover:bg-muted";

/**
 * Monday-first grid of the weeks the month draws. A cell shows its first three chips by time and a
 * "+N más" link to the day view. On a phone the cells are too narrow for chips, so they collapse to
 * a count; the day number still opens the day.
 */
export function MonthView({ date, today, items }: { date: string; today: string; items: readonly AgendaItem[] }) {
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
        .map((key) => {
          const dayItems = byDay.get(key) ?? [];
          const hidden = dayItems.length - CHIPS_PER_CELL;
          return (
            <div key={key} data-testid={`cell-${key}`} className={cn("flex min-w-0 flex-col gap-1 rounded-md border p-1", !key.startsWith(month) && "opacity-50")}>
              <Link
                href={`/agenda?view=day&date=${key}`}
                aria-current={key === today ? "date" : undefined}
                className={cn(TARGET, "self-start font-semibold", key === today && "bg-primary text-primary-foreground hover:bg-primary")}
              >
                {Number(key.slice(8))}
              </Link>
              <DayBooking day={key} />
              {dayItems.length > 0 ? (
                <span aria-label={`${dayItems.length} ${dayItems.length === 1 ? "cita" : "citas"}`} className="text-xs text-muted-foreground md:hidden">
                  {dayItems.length}
                </span>
              ) : null}
              <ul className="flex flex-col gap-1 max-md:hidden">
                {dayItems.slice(0, CHIPS_PER_CELL).map((item) => (
                  <li key={item.id} className="flex flex-col gap-1">
                    <AgendaChip item={item} />
                    <ItemActions item={item} />
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
