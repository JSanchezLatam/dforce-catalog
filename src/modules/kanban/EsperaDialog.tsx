"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ESPERA_MOTIVO_LABEL } from "@/modules/service-orders/statuses";
import { OrderLine } from "./ConfirmMoveDialog";
import type { KanbanCard } from "./shape";

export type Motivo = keyof typeof ESPERA_MOTIVO_LABEL;
const HELP: Record<Motivo, string> = { repuesto: "Falta que llegue una pieza", aprobacion_cliente: "El cliente tiene que aprobar el trabajo" };

/** The reason a card is put on hold; the confirm button waits for a choice. */
export function EsperaDialog({ card, onConfirm, onClose }: { card: KanbanCard; onConfirm: (motivo: Motivo) => void; onClose: () => void }) {
  const [motivo, setMotivo] = useState<Motivo | null>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>¿Por qué queda en espera?</DialogTitle>
          <DialogDescription>El motivo se ve en la tarjeta y en la Pantalla del taller, junto con cuánto lleva esperando.</DialogDescription>
        </DialogHeader>
        <OrderLine card={card} />
        <div className="grid gap-2">
          {(Object.keys(HELP) as Motivo[]).map((m) => (
            <button
              key={m} type="button" aria-pressed={motivo === m} onClick={() => setMotivo(m)}
              className={cn("flex min-h-14 flex-col justify-center rounded-xl border px-4 text-left", motivo === m ? "border-2 border-foreground" : "border-border")}
            >
              <b className="text-sm">{ESPERA_MOTIVO_LABEL[m]}</b>
              <span className="text-xs text-muted-foreground">{HELP[m]}</span>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11 px-4" onClick={onClose}>Cancelar</Button>
          <Button type="button" className="min-h-11 px-4" disabled={motivo === null} onClick={() => motivo && onConfirm(motivo)}>Pasar a En espera</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
