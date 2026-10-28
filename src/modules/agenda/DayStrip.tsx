import Link from "next/link";

import { cn } from "@/lib/utils";
import { addDays, weekStart, WEEKDAY_SHORT, type AgendaView } from "@/modules/agenda/dates";

/**
 * Phone only (`md:hidden`): the selected day's Monday-Sunday week as plain links that rewrite `date` and keep `view`.
 * Today is `aria-current="date"`, the selected day `data-selected`, a dot marks the days with appointments. The strip
 * scrolls inside itself, so the page never does.
 */
export function DayStrip({ view, date, today, busyDays }: { view: AgendaView; date: string; today: string; busyDays: readonly string[] }) {
  return (
    <nav aria-label="Días de la semana" className="flex gap-1 overflow-x-auto md:hidden">
      {Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i)).map((key, i) => (
        <Link
          key={key}
          href={`/agenda?view=${view}&date=${key}`}
          aria-current={key === today ? "date" : undefined}
          data-selected={key === date ? "" : undefined}
          className={cn("relative flex min-h-11 min-w-11 flex-1 shrink-0 flex-col items-center justify-center rounded-lg px-1 text-xs", key === date ? "bg-foreground text-background" : "bg-muted", key === today && key !== date && "ring-2 ring-foreground")}
        >
          <span>{WEEKDAY_SHORT[i]}</span>
          <span className="text-base font-semibold">{Number(key.slice(8))}</span>
          {busyDays.includes(key) ? (
            <>
              <span data-busy-dot aria-hidden className="absolute bottom-1 size-1 rounded-full bg-current" />
              <span className="sr-only"> con citas</span>
            </>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
