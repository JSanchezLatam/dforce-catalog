import Link from "next/link";

import { cn } from "@/lib/utils";
import { stepDate, weekStart, type AgendaView } from "@/modules/agenda/dates";
import { RefreshListButton } from "@/modules/service-orders/RefreshListButton";

const VIEWS: { view: AgendaView; label: string }[] = [
  { view: "day", label: "Día" },
  { view: "week", label: "Semana" },
  { view: "month", label: "Mes" },
  { view: "combined", label: "Combinada" },
];

const NAV = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-3 text-sm hover:bg-muted";

const dmy = (key: string) => `${key.slice(8)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;

/** Digits only: no Intl, no month names. */
function rangeLabel(view: AgendaView, date: string): string {
  if (view === "month") return `${date.slice(5, 7)}/${date.slice(0, 4)}`;
  return view === "week" ? `Semana del ${dmy(weekStart(date))}` : dmy(date);
}

/** Plain links only: the URL is the state, so there is nothing to hydrate but the refresh button. */
export function AgendaHeader({ view, date, today, truncated }: { view: AgendaView; date: string; today: string; truncated: boolean }) {
  const to = (v: AgendaView, d: string) => `/agenda?view=${v}&date=${d}`;
  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={to(view, stepDate(view, date, -1))} className={NAV}>Anterior</Link>
        <Link href={to(view, today)} className={NAV}>Hoy</Link>
        <Link href={to(view, stepDate(view, date, 1))} className={NAV}>Siguiente</Link>
        <span className="px-2 text-sm font-semibold tabular-nums">{rangeLabel(view, date)}</span>
        <RefreshListButton />
      </div>
      <nav aria-label="Vista" className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Link key={v.view} href={to(v.view, date)} aria-current={v.view === view ? "page" : undefined} className={cn(NAV, v.view === view && "bg-primary text-primary-foreground hover:bg-primary")}>
            {v.label}
          </Link>
        ))}
      </nav>
      {truncated ? <p role="status" className="text-sm text-amber-700 dark:text-amber-300">Se muestran las primeras 500 citas; acotá el rango.</p> : null}
    </div>
  );
}
