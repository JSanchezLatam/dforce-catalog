import { Car, Phone } from "lucide-react";
import Link from "next/link";

import type { AgendaItem } from "@/modules/agenda/items";

/**
 * The earliest future booked appointment, frozen at render: `label` ("en 20 min") is computed by the server from its
 * one clock, and there is no timer here, so it changes only after a refresh. Teal with an explicit dark variant:
 * the mockup's `teal-700` alone would glare on the dark card background.
 */
export function NextCard({ next }: { next: { item: AgendaItem; label: string } | null }) {
  if (!next) return <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Sin citas próximas</div>;
  const { item, label } = next;
  return (
    <div className="rounded-xl bg-teal-700 p-4 text-white dark:bg-teal-900">
      <div className="flex items-center justify-between text-xs text-teal-50">
        <span>Próxima cita · {label}</span>
        <span className="font-semibold">{item.time}</span>
      </div>
      <div className="mt-2 text-base font-semibold">{item.customerName}</div>
      <div className="flex items-center gap-1 text-sm text-teal-50"><Car aria-hidden className="size-4" />{item.vehicleLabel}</div>
      {item.description ? <div data-description className="mt-1 text-xs text-teal-50">{item.description}</div> : null}
      <div className="mt-3 flex gap-2">
        <Link href={item.href} className="inline-flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-lg bg-white px-3 text-sm font-semibold text-teal-900">Abrir orden</Link>
        <a href={`tel:${item.customerPhone}`} aria-label={`Llamar a ${item.customerName}`} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-teal-900 px-3 text-white dark:bg-teal-700"><Phone aria-hidden className="size-4" /></a>
      </div>
    </div>
  );
}
