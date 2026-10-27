import type { ComponentProps } from "react";
import Link from "next/link";

import { DayGrid } from "@/modules/agenda/DayGrid";
import type { AgendaItem, WorkshopItem } from "@/modules/agenda/items";
import { StatusBadge } from "@/shared/ui/StatusBadge";

function WorkshopRow({ item }: { item: WorkshopItem }) {
  return (
    <Link href={item.href} className="flex min-h-11 flex-col gap-0.5 rounded-md border bg-card px-2 py-1 text-sm hover:bg-muted">
      <span className="font-medium">{item.customerName}</span>
      <span className="text-muted-foreground">{item.customerPhone}</span>
      <span className="text-muted-foreground">{item.vehicleLabel}</span>
      <StatusBadge status={item.status} label={item.statusLabel} className="self-start" />
      {item.holdReason ? <span className="text-xs text-muted-foreground">{item.holdReason}</span> : null}
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
  "todayKey" | "nowMinute" | "selectedId" | "onSelect"
>) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section aria-labelledby="combined-day" className="flex min-w-0 flex-col gap-2">
        <h2 id="combined-day" className="text-base font-semibold">Citas del día</h2>
        <DayGrid date={date} items={items} {...grid} />
      </section>
      <section aria-labelledby="combined-shop" className="flex min-w-0 flex-col gap-2">
        <h2 id="combined-shop" className="text-base font-semibold">En el taller</h2>
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
