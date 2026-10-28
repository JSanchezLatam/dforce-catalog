import type { ComponentProps } from "react";
import { Clock } from "lucide-react";
import Link from "next/link";

import { DayGrid } from "@/modules/agenda/DayGrid";
import type { AgendaItem, WorkshopItem } from "@/modules/agenda/items";
import { StatusBadge } from "@/shared/ui/StatusBadge";

/** One order on the shop floor. No phone here (the spec keeps it off); the whole card is the link to the order. */
function WorkshopRow({ item }: { item: WorkshopItem }) {
  return (
    <Link href={item.href} className="flex min-h-11 min-w-11 flex-col gap-1 rounded-lg border bg-card px-3 py-2 text-sm hover:bg-muted">
      <span className="flex items-center gap-2">
        <span aria-hidden className="agenda-dot size-2.5 shrink-0 rounded-full" data-categoria={item.categoria ?? "none"} />
        <span className="min-w-0 truncate font-semibold">{item.vehicleLabel}</span>
      </span>
      <span className="truncate">{item.customerName}</span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <StatusBadge status={item.status} label={item.statusLabel} />
        <span className="inline-flex items-center gap-1">
          <Clock aria-hidden className="size-3" />
          {item.sinceLabel}
        </span>
        <span>{item.technicianInitials}</span>
      </span>
      {item.status === "on_hold" && item.holdReason && item.holdSinceLabel ? (
        <span className="text-xs font-medium text-amber-700 dark:text-amber-300">{`${item.holdReason} · ${item.holdSinceLabel}`}</span>
      ) : null}
    </Link>
  );
}

/** The selected day's hour grid beside every order in the workshop; one column (appointments first) below `lg`. */
export function CombinedView({
  date,
  items,
  workshop,
  workshopTruncated,
  ...grid
}: { date: string; items: readonly AgendaItem[]; workshop: readonly WorkshopItem[]; workshopTruncated: boolean } & Pick<
  ComponentProps<typeof DayGrid>,
  "todayKey" | "nowMinute" | "selectedId" | "onSelect" | "onSlot" | "emptyText"
>) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section aria-labelledby="combined-day" className="flex min-w-0 flex-col gap-2">
        <h2 id="combined-day" className="text-base font-semibold">Citas del día</h2>
        <DayGrid date={date} items={items} {...grid} />
      </section>
      <section aria-labelledby="combined-shop" className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 id="combined-shop" className="text-base font-semibold">En el taller ahora</h2>
          <span data-testid="workshop-count" className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{workshop.length}</span>
        </div>
        {workshop.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin órdenes en el taller</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {workshop.map((item) => (
              <li key={item.id}>
                <WorkshopRow item={item} />
              </li>
            ))}
          </ul>
        )}
        {workshopTruncated ? <p role="status" className="text-sm text-amber-700 dark:text-amber-300">Se muestran las primeras 500 órdenes en el taller.</p> : null}
      </section>
    </div>
  );
}
