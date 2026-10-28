"use client";

import { ExternalLink, Flag, FlagOff, Trash2, X } from "lucide-react";
import Link from "next/link";
import { createElement } from "react";

import { cn } from "@/lib/utils";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { STATUS_HUE, UrgentBadge } from "@/modules/board/primitives";
import { ORDER_STATUS_LABEL } from "@/modules/service-orders/statuses";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import { menuItems } from "./CardMenu";
import type { KanbanCard } from "./shape";

const row = "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] hover:bg-muted";

/** The phone's ⋯: the same actions as the card menu (`menuItems`), in a bottom sheet. It only reports the choice. */
export function MoveSheet({ card, canMove, open, onClose, onMove, onUrgent }: {
  card: KanbanCard; canMove: boolean; open: boolean; onClose: () => void; onMove: (target: OrderStatus) => void; onUrgent: (on: boolean) => void;
}) {
  const { targets, cancel, urgent } = menuItems(card, canMove);
  const act = (fn: () => void) => () => (onClose(), fn());
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" showCloseButton={false} className="rounded-t-3xl px-4 pb-6">
        <SheetHeader className="flex-row items-center gap-3 px-1">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <SheetTitle className="text-lg font-extrabold">{card.missing.includes("vehiculo") ? "Sin placa" : card.plate}</SheetTitle>
              {card.urgent && <UrgentBadge />}
            </div>
            <SheetDescription>{[card.make, card.model, card.statusLabel].filter(Boolean).join(" · ")}</SheetDescription>
          </div>
          <SheetClose aria-label="Cerrar" className="grid size-11 shrink-0 place-items-center rounded-full bg-muted"><X aria-hidden="true" className="size-4.5" /></SheetClose>
        </SheetHeader>
        {targets.length > 0 && (
          <div role="group" aria-labelledby={`${card.id}-mover`} className="grid gap-1">
            <div id={`${card.id}-mover`} className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mover a</div>
            {targets.map((t) => (
              <button key={t} type="button" className={cn(row, "border")} onClick={act(() => onMove(t))}>
                {createElement(STATUS_HUE[t as keyof typeof STATUS_HUE].icon, { "aria-hidden": true, className: "size-4" })}{ORDER_STATUS_LABEL[t]}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-1">
          {urgent && (
            <button type="button" className={row} onClick={act(() => onUrgent(urgent === "mark"))}>
              {urgent === "mark" ? <Flag aria-hidden="true" className="size-4.5" /> : <FlagOff aria-hidden="true" className="size-4.5" />}
              {urgent === "mark" ? "Marcar como urgente" : "Quitar urgente"}
            </button>
          )}
          <Link href={`/service-orders/${card.id}`} className={row} onClick={onClose}><ExternalLink aria-hidden="true" className="size-4.5" />Ver orden</Link>
          {cancel && (
            <button type="button" className={cn(row, "text-red-600 dark:text-red-400")} onClick={act(() => onMove("cancelled"))}>
              <Trash2 aria-hidden="true" className="size-4.5" />Cancelar orden
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
