"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ORDER_STATUS_LABEL } from "@/modules/service-orders/statuses";
import { getManualTransitions, type OrderStatus } from "@/modules/service-orders/transitions";
import { legalTargets } from "./plan";
import type { KanbanCard } from "./shape";

/** What the ⋯ menu offers. A técnico (`canMove` false) gets neither moves nor "Cancelar orden". */
export function menuItems(card: Pick<KanbanCard, "status">, canMove: boolean) {
  return {
    targets: canMove ? legalTargets(card.status) : [],
    cancel: canMove && getManualTransitions(card.status).includes("cancelled"),
  };
}

const item = "min-h-11 px-3";

/** The card's ⋯ menu. It only reports the chosen target; `planMove` and the dialogs live in the board. */
export function CardMenu({ card, canMove, onMove }: { card: KanbanCard; canMove: boolean; onMove: (target: OrderStatus) => void }) {
  const { targets, cancel } = menuItems(card, canMove);
  const who = card.missing.includes("vehiculo") ? "la orden" : card.plate;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Acciones de la orden" className="-mt-1.5 -mr-1.5 grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted">
        <Ellipsis aria-hidden="true" className="size-4.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-52">
        {targets.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={item}>Mover a…</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuGroup>
                <DropdownMenuLabel>{`Mover ${who} a…`}</DropdownMenuLabel>
                {targets.map((t) => (
                  <DropdownMenuItem key={t} className={item} onClick={() => onMove(t)}>{ORDER_STATUS_LABEL[t]}</DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuItem className={item} render={<Link href={`/service-orders/${card.id}`} />}>Ver orden</DropdownMenuItem>
        {cancel && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" className={item} onClick={() => onMove("cancelled")}>Cancelar orden</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
