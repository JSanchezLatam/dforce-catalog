import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { addDays, formatMonthYear, monthGrid, stepDate, weekStart, type AgendaView } from "@/modules/agenda/dates";

const HEAD = ["L", "M", "M", "J", "V", "S", "D"];
const CTRL = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted";

/**
 * A Monday-first month grid of plain links that rewrite `date` and keep `view`. Plain data in, static text out (no
 * Intl); `busyDays` are the Panama days of the displayed month that have an appointment.
 */
export function MiniCalendar({ view, date, today, busyDays }: { view: AgendaView; date: string; today: string; busyDays: readonly string[] }) {
  const to = (d: string) => `/agenda?view=${view}&date=${d}`;
  const first = `${date.slice(0, 7)}-01`;
  const monday = weekStart(date);
  const week = new Set(Array.from({ length: 7 }, (_, i) => addDays(monday, i)));
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <strong className="text-sm">{formatMonthYear(date)}</strong>
        <div className="flex">
          <Link href={to(stepDate("month", first, -1))} aria-label="Mes anterior" className={CTRL}><ChevronLeft aria-hidden className="size-4" /></Link>
          <Link href={to(stepDate("month", first, 1))} aria-label="Mes siguiente" className={CTRL}><ChevronRight aria-hidden className="size-4" /></Link>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-xs">
        {HEAD.map((h, i) => (
          <span key={i} data-weekday aria-hidden className="pb-1 text-[11px] font-medium text-muted-foreground">{h}</span>
        ))}
        {monthGrid(date).flat().map((key, i) => {
          const outside = key.slice(0, 7) !== first.slice(0, 7);
          const busy = !outside && busyDays.includes(key);
          return (
            <Link
              key={key}
              href={to(key)}
              data-day={key}
              data-selected-week={week.has(key) ? "" : undefined}
              data-outside={outside ? "" : undefined}
              aria-current={key === today ? "date" : undefined}
              className={cn("relative flex min-h-11 items-center justify-center", week.has(key) && "bg-muted", week.has(key) && i % 7 === 0 && "rounded-l-full", week.has(key) && i % 7 === 6 && "rounded-r-full", outside && "opacity-50")}
            >
              <span className={cn("grid size-8 place-items-center rounded-full", key === today && "bg-foreground font-bold text-background")}>{Number(key.slice(8))}</span>
              {busy ? (
                <>
                  <span data-busy-dot aria-hidden className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-muted-foreground" />
                  <span className="sr-only"> con citas</span>
                </>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
