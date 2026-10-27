/**
 * agenda/AgendaDetail.tsx - the content of an appointment's Detail. The shell puts it in a popover (md and up) or a
 * bottom sheet (below md); this component knows neither. A plain component: the close is reported through
 * `onClose`, and every text comes from the item (the day text from static tables, so server and browser agree).
 */
import Link from "next/link";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatLongDay } from "@/modules/agenda/dates";
import { ItemActions } from "@/modules/agenda/ItemActions";
import type { AgendaItem } from "@/modules/agenda/items";
import { CATEGORIA_LABEL } from "@/modules/service-orders/categories";

const LINK = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-sm font-medium";

/** "Cita agendada" for a booked appointment that is not Vencida; every other state names itself. */
const statusTitle = (item: AgendaItem) => (item.overdue ? "Vencida" : item.status === "booked" ? "Cita agendada" : item.statusLabel);

export function AgendaDetail({ item, onClose }: { item: AgendaItem; onClose: () => void }) {
  return (
    <div className="flex max-h-[80vh] flex-col gap-3 overflow-y-auto">
      <div className="flex items-center gap-1">
        <span className="mr-auto text-xs font-semibold uppercase tracking-wide text-muted-foreground">{statusTitle(item)}</span>
        <Link href={item.href} aria-label="Abrir orden" className={`${LINK} hover:bg-muted`}>
          <Pencil aria-hidden className="size-4" />
        </Link>
        <Button type="button" variant="ghost" className="min-h-11 min-w-11" onClick={onClose}>
          Cerrar
        </Button>
      </div>
      <div>
        <p className="text-base font-semibold">{item.customerName}</p>
        <p className="text-sm text-muted-foreground">{formatLongDay(item.dayKey)}</p>
        <p className="text-sm text-muted-foreground">{item.time}</p>
      </div>
      <p className="text-sm">{item.vehicleDetail}</p>
      <a href={`tel:${item.customerPhone}`} className="inline-flex min-h-11 items-center text-sm underline">
        {item.customerPhone}
      </a>
      <p className="whitespace-pre-wrap break-words text-sm">{item.description?.trim() ? item.description : "Sin descripción"}</p>
      <ul aria-label="Categoría" className="flex flex-wrap gap-1.5">
        {Object.entries(CATEGORIA_LABEL).map(([key, label]) => (
          <li
            key={key}
            data-categoria={key}
            aria-current={item.categoria === key ? "true" : undefined}
            className={`agenda-ev rounded-full px-2.5 py-1 text-xs font-semibold ${item.categoria === key ? "ring-2 ring-foreground" : "opacity-60"}`}
          >
            {label}
          </li>
        ))}
      </ul>
      <ul aria-label="Técnicos" className="flex flex-col gap-1 text-sm">
        {item.technicians.length === 0 ? (
          <li className="text-muted-foreground">Sin técnico</li>
        ) : (
          item.technicians.map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-muted text-[10px] font-semibold">{t.initials}</span>
              {t.nombre}
            </li>
          ))
        )}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={item.href} className={`${LINK} bg-primary px-4 text-primary-foreground hover:bg-primary/90`}>
          Abrir orden
        </Link>
        <ItemActions item={item} />
      </div>
    </div>
  );
}
