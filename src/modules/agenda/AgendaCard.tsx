/**
 * agenda/AgendaCard.tsx - one appointment as a one-hour block. A plain component (no "use client", no server
 * imports) so the client shell renders it; every text comes from the item, which the server formatted. Colour is
 * the `data-categoria` hook in globals.css, and the status is always ALSO text.
 */
import { Car, Check, Clock, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AgendaItem } from "@/modules/agenda/items";

/** The status text a card shows: none for a plain booked card. */
function statusText(item: AgendaItem): string | null {
  if (item.noShow) return item.statusLabel;
  if (item.overdue) return "Vencida";
  return item.muted ? item.statusLabel : null;
}

/** Decoration only: the status is already the pill's text. */
function StatusIcon({ item }: { item: AgendaItem }) {
  const Icon = item.noShow ? X : item.overdue ? Clock : Check;
  return <Icon aria-hidden className="size-3" />;
}

export function AgendaCard({ item, selected = false, onSelect }: { item: AgendaItem; selected?: boolean; onSelect?: (item: AgendaItem) => void }) {
  const status = statusText(item);
  const names = item.technicians.map((t) => t.nombre).join(", ");
  const name = [`${item.time} ${item.customerName}`, item.categoriaLabel, item.vehicleLabel, status, names].filter(Boolean).join(", ");
  return (
    <button
      type="button"
      data-categoria={item.categoria ?? "none"}
      aria-pressed={selected}
      aria-label={name}
      onClick={() => onSelect?.(item)}
      className={cn(
        "agenda-ev flex h-full min-h-11 w-full min-w-11 flex-col overflow-hidden rounded-lg text-left",
        item.noShow ? "opacity-45" : item.muted && "opacity-60",
        selected ? "ring-2 ring-foreground" : item.overdue && "ring-2 ring-destructive",
      )}
    >
      <span className="agenda-ev-strip block w-full truncate px-2 py-1 text-[11px] font-semibold">{`${item.time} · ${item.categoriaLabel}`}</span>
      <span className="flex min-h-0 w-full flex-1 flex-col gap-0.5 px-2 py-1.5">
        <span className={cn("truncate text-[13px] font-semibold", item.noShow && "line-through")}>{item.customerName}</span>
        <span className="flex items-center gap-1 text-[11px] opacity-80">
          <Car aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{item.vehicleLabel}</span>
        </span>
        <span className="mt-auto flex items-center justify-between gap-1">
          {item.technicians.length > 0 ? (
            <span className="flex -space-x-1.5">
              {item.technicians.map((t) => (
                <span key={t.id} title={t.nombre} className="grid size-[18px] place-items-center rounded-full bg-foreground text-[8px] font-semibold text-background ring-2 ring-card">
                  {t.initials}
                </span>
              ))}
            </span>
          ) : status === null ? (
            <span className="truncate text-[11px] opacity-70">Sin técnico</span>
          ) : null}
          {status ? (
            <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-semibold", item.overdue && !item.muted ? "bg-destructive text-white" : "bg-black/10 dark:bg-white/10")}>
              <StatusIcon item={item} />
              {status}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
