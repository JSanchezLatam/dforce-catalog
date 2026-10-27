"use client";

import { useState, type ReactNode } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { TYPE_KEYS, type TypeKey } from "@/modules/agenda/items";
import { categoriaLabel } from "@/modules/service-orders/categories";

const CARD = "rounded-xl border bg-card p-4";

/**
 * The left column: calendar and Próxima cita (slots, later units), the Categoría filter, "Esta semana". From `lg` it is
 * always shown; below it, it hides behind a "Filtros" disclosure button. CSS decides, so no width is read in render.
 */
export function AgendaSidebar({ counts, hidden, summary, onToggle, onAll, calendar, next }: {
  counts: Record<TypeKey, number>;
  hidden: readonly TypeKey[];
  summary: readonly { label: string; count: number }[];
  onToggle: (key: TypeKey) => void;
  onAll: () => void;
  calendar?: ReactNode;
  next?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3 lg:w-72 lg:shrink-0">
      <button type="button" aria-expanded={open} aria-controls="agenda-sidebar" onClick={() => setOpen(!open)} className="inline-flex min-h-11 min-w-11 items-center justify-center self-start rounded-md border px-3 text-sm hover:bg-muted lg:hidden">
        Filtros
      </button>
      <div id="agenda-sidebar" className={cn("flex-col gap-3", open ? "flex" : "hidden lg:flex")}>
        {calendar}
        {next}
        <section aria-labelledby="agenda-categoria" className={CARD}>
          <div className="mb-2 flex items-center justify-between">
            <h2 id="agenda-categoria" className="text-sm font-semibold">Categoría</h2>
            <button type="button" onClick={onAll} className="min-h-11 px-2 text-xs text-muted-foreground underline">Todos</button>
          </div>
          {TYPE_KEYS.map((key) => (
            <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <Checkbox checked={!hidden.includes(key)} onCheckedChange={() => onToggle(key)} />
              <span className="agenda-dot size-2.5 rounded-full" data-categoria={key} />
              <span className="flex-1">{categoriaLabel(key === "none" ? null : key)}</span>{" "}
              <span className="rounded-md bg-muted px-1.5 text-xs font-semibold">{counts[key]}</span>
            </label>
          ))}
        </section>
        <section aria-labelledby="agenda-semana" className={CARD}>
          <h2 id="agenda-semana" className="text-sm font-semibold">Esta semana</h2>
          <div className="mt-3 flex flex-col gap-2 text-sm">
            {summary.map(({ label, count }) => (
              <div key={label} className="flex justify-between">
                <span>{label}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
