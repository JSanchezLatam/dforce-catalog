"use client";

import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { KanbanCard } from "./shape";

const LABEL = { vehiculo: "Vehículo", categoria: "Categoría" } as const;

/** Receiving needs a vehicle and a category; nothing was sent, so this only points at the order. */
export function IncompleteDialog({ card, onClose }: { card: KanbanCard; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Todavía no se puede recibir</DialogTitle>
          <DialogDescription>Completá el vehículo y la categoría antes de recibir la orden.</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2 text-sm">
          {card.missing.map((m) => (
            <li key={m} className="flex items-center gap-2 rounded-lg border px-3 py-2">
              <span className="flex-1">{LABEL[m]}</span>
              <span className="text-xs text-muted-foreground">sin cargar</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11 px-4" onClick={onClose}>Cerrar</Button>
          <Link href={`/service-orders/${card.id}`} className={buttonVariants({ className: "min-h-11 px-4" })}>Editar orden</Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
