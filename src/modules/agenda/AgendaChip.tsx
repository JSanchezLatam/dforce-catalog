import Link from "next/link";

import { cn } from "@/lib/utils";
import type { AgendaItem } from "@/modules/agenda/items";
import { StatusBadge } from "@/shared/ui/StatusBadge";

/** One appointment: time, customer, phone, plate. Never the description (free text, unbounded). */
export function AgendaChip({ item }: { item: AgendaItem }) {
  return (
    <Link
      href={item.href}
      className={cn(
        "flex min-h-11 flex-col gap-0.5 rounded-md border bg-card px-2 py-1 text-sm hover:bg-muted",
        item.muted && "opacity-60",
        item.overdue && "border-red-500",
      )}
    >
      <span className="font-medium tabular-nums">{item.time}</span>
      <span>{item.customerName}</span>
      <span className="text-muted-foreground">{item.customerPhone}</span>
      <span className="text-muted-foreground">{item.vehicleLabel}</span>
      {item.muted ? <StatusBadge status={item.status} label={item.statusLabel} className="self-start" /> : null}
      {item.overdue ? <span className="self-start text-xs font-semibold text-red-700 dark:text-red-300">Vencida</span> : null}
    </Link>
  );
}
