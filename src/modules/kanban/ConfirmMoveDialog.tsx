"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import type { KanbanCard } from "./shape";

type Copy = { title: string; body: string; yes: string; no: string; danger?: true };

/** Copy per confirmed move. The `done` text is the approved mockup's; the others state what the server does. */
function copyFor(from: OrderStatus, to: OrderStatus): Copy {
  if (to === "cancelled") return { title: "¿Cancelar la orden?", body: "La orden queda cancelada y no se puede reabrir.", yes: "Sí, cancelar orden", no: "Volver", danger: true };
  if (to === "done") return { title: "¿Marcar la orden como Completada?", body: "La orden se cierra y deja de poder editarse. Para corregirla después hace falta un administrador.", yes: "Sí, completar", no: "Cancelar" };
  return { title: "¿Devolver la orden a En progreso?", body: "Se reabren todas las partes: las marcas de listo se borran.", yes: "Sí, devolver", no: "Cancelar" };
}

/** Which order a dialog is about; the menu that opened it is already gone. */
export function OrderLine({ card }: { card: Pick<KanbanCard, "plate" | "make" | "model"> }) {
  return (
    <p className="rounded-lg bg-muted px-3 py-2 text-sm">
      <b>{card.plate}</b>
      {card.make && <span className="text-muted-foreground">{` · ${card.make} ${card.model ?? ""}`.trimEnd()}</span>}
    </p>
  );
}

export function ConfirmMoveDialog({ card, target, onConfirm, onClose }: { card: KanbanCard; target: OrderStatus; onConfirm: () => void; onClose: () => void }) {
  const c = copyFor(card.status, target);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{c.title}</DialogTitle>
          <DialogDescription>{c.body}</DialogDescription>
        </DialogHeader>
        <OrderLine card={card} />
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11 px-4" onClick={onClose}>{c.no}</Button>
          <Button type="button" variant={c.danger ? "destructive" : "default"} className="min-h-11 px-4" onClick={onConfirm}>{c.yes}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
