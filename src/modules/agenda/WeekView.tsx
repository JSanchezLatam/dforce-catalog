import Link from "next/link";

import { cn } from "@/lib/utils";
import { DayBooking } from "@/modules/agenda/AgendaBookingForm";
import { AgendaChip } from "@/modules/agenda/AgendaChip";
import { addDays, weekStart, WEEKDAY_SHORT } from "@/modules/agenda/dates";
import { groupByDay, type AgendaItem } from "@/modules/agenda/items";

/** Seven Monday-first columns from `md`; below that the same markup is a vertical list of days. */
export function WeekView({ date, today, items }: { date: string; today: string; items: readonly AgendaItem[] }) {
  const byDay = groupByDay(items);
  const start = weekStart(date);
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
      {WEEKDAY_SHORT.map((name, i) => {
        const key = addDays(start, i);
        const isToday = key === today;
        return (
          <section key={key} data-testid={`day-${key}`} className="flex min-w-0 flex-col gap-2">
            <Link
              href={`/agenda?view=day&date=${key}`}
              aria-current={isToday ? "date" : undefined}
              className={cn("flex min-h-11 min-w-11 items-center rounded-md px-2 text-sm font-semibold hover:bg-muted", isToday && "bg-primary text-primary-foreground hover:bg-primary")}
            >
              {name} {Number(key.slice(8))}
            </Link>
            <DayBooking day={key} />
            {(byDay.get(key) ?? []).map((item) => (
              <AgendaChip key={item.id} item={item} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
