/**
 * agenda/AgendaDetail.tsx - the content of an appointment's Detail. The shell puts it in a popover (md and up) or a
 * bottom sheet (below md); this component knows neither. A client component: the close is reported through
 * `onClose`, every text comes from the item (the day text from static tables, so server and browser agree), and a
 * booked Detail edits the category through `patchOrder` and assigns a technician through the existing control. The
 * shell keys it by order id, so its pending and error state never follow the selection to another appointment.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatLongDay } from "@/modules/agenda/dates";
import { ItemActions } from "@/modules/agenda/ItemActions";
import type { AgendaItem } from "@/modules/agenda/items";
import { patchOrder } from "@/modules/agenda/patchOrder";
import { CATEGORIA_LABEL, type ServiceCategory } from "@/modules/service-orders/categories";
import { AssignTecnicoControl } from "@/modules/service-orders/AssignTecnicoControl";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { useToast } from "@/shared/ui/ToastProvider";

const LINK = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-sm font-medium";

/** "Cita agendada" for a booked appointment that is not Vencida; every other state names itself. */
const statusTitle = (item: AgendaItem) => (item.overdue ? "Vencida" : item.status === "booked" ? "Cita agendada" : item.statusLabel);

const CHIP = "agenda-ev min-h-11 rounded-full px-3 text-xs font-semibold";

/** "+ Asignar técnico" opens the existing control; it lists the active roster minus whoever is already on the order. */
function AssignSection({ item, roster }: { item: AgendaItem; roster: { id: string; nombre: string }[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" variant="outline" className="min-h-11 min-w-11 self-start" onClick={() => setOpen(true)}>
        + Asignar técnico
      </Button>
    );
  }
  return <AssignTecnicoControl orderId={item.id} available={roster.filter((t) => !item.technicians.some((x) => x.id === t.id))} />;
}

/** `roster` is the active technicians, present only for a user who may assign; absent means no assign control. */
export function AgendaDetail({ item, roster = null, onClose }: { item: AgendaItem; roster?: { id: string; nombre: string }[] | null; onClose: () => void }) {
  const router = useRouter();
  const { addToast } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = item.status === "booked";

  async function choose(categoria: ServiceCategory) {
    if (categoria === item.categoria) return;
    setPending(true);
    setError(null);
    // `expectedStatus` makes a stale screen refuse (409) instead of editing an order received meanwhile.
    const failure = await patchOrder(item.id, { categoria, expectedStatus: "booked" });
    setPending(false);
    if (failure) {
      setError(failure);
      return;
    }
    // ABOVE the refresh, BELOW the try/catch (inside patchOrder): a refresh that throws must not retract the toast.
    addToast("success", "Categoría actualizada");
    router.refresh();
  }

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
      {editable ? (
        <div role="group" aria-label="Categoría" className="flex flex-wrap gap-1.5">
          {(Object.entries(CATEGORIA_LABEL) as [ServiceCategory, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              data-categoria={key}
              aria-pressed={item.categoria === key}
              disabled={pending}
              onClick={() => choose(key)}
              className={`${CHIP} ${item.categoria === key ? "ring-2 ring-foreground" : "opacity-60"}`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : (
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
      )}
      {error ? (
        <p role="alert" className={FIELD_ERROR}>
          {error}
        </p>
      ) : null}
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
      {editable && roster ? <AssignSection item={item} roster={roster} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={item.href} className={`${LINK} bg-primary px-4 text-primary-foreground hover:bg-primary/90`}>
          Abrir orden
        </Link>
        <ItemActions item={item} onSuccess={onClose} />
      </div>
    </div>
  );
}
