"use client";

import { Ellipsis, Info } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { statusBarHint } from "@/modules/service-orders/hints";
import { ORDER_STATUS_LABEL } from "@/modules/service-orders/statuses";
import { getManualTransitions, type OrderStatus } from "@/modules/service-orders/transitions";
import { MoveSheet } from "./MoveSheet";
import { legalTargets } from "./plan";
import type { KanbanCard } from "./shape";

/** An open order has no manual move to En diagnóstico: it passes when a technician is assigned. */
const OPEN_REASON = statusBarHint({ status: "open", missing: [], assignees: [], assignableCount: 0, canAssign: true, canManageTechnicians: false })!.text;

/** What the ⋯ menu offers. A técnico (`canMove` false) gets neither moves nor "Cancelar orden". */
export function menuItems(card: Pick<KanbanCard, "status" | "urgent">, canMove: boolean) {
  return {
    targets: canMove ? legalTargets(card.status) : [],
    blocked: canMove && card.status === "open" ? OPEN_REASON : null,
    cancel: canMove && getManualTransitions(card.status).includes("cancelled"),
    // A done order is closed: the server answers 409 to the flag, so the toggle is not offered.
    urgent: canMove && card.status !== "done" ? (card.urgent ? ("clear" as const) : ("mark" as const)) : null,
  };
}

const item = "min-h-11 px-3";

/** The card's ⋯ menu. It only reports the chosen target; `planMove` and the dialogs live in the board. */
export function CardMenu({ card, canMove, onMove, onUrgent }: { card: KanbanCard; canMove: boolean; onMove: (target: OrderStatus) => void; onUrgent: (on: boolean) => void }) {
  const { targets, blocked, cancel, urgent } = menuItems(card, canMove);
  const who = card.missing.includes("vehiculo") ? "la orden" : card.plate;
  const [shown, setShown] = useState<"menu" | "sheet" | null>(null);
  return (
    <>
    {/* The width is read here, in the open request, never while rendering: a render-time read differs between server and browser. */}
    <DropdownMenu open={shown === "menu"} onOpenChange={(o) => setShown(o ? (window.matchMedia("(max-width: 767px)").matches ? "sheet" : "menu") : null)}>
      <DropdownMenuTrigger aria-label="Acciones de la orden" className="-mt-1.5 -mr-1.5 grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted">
        <Ellipsis aria-hidden="true" className="size-4.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-52">
        {blocked && (
          <>
            <DropdownMenuItem disabled className="min-h-11 items-start px-3 py-2.5 text-[13px] leading-[18px] text-muted-foreground data-disabled:opacity-100">
              <Info aria-hidden="true" className="mt-px" />
              <span>{blocked}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
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
        {urgent && (
          <DropdownMenuItem className={item} onClick={() => onUrgent(urgent === "mark")}>{urgent === "mark" ? "Marcar como urgente" : "Quitar urgente"}</DropdownMenuItem>
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
    <MoveSheet card={card} canMove={canMove} open={shown === "sheet"} onClose={() => setShown(null)} onMove={onMove} onUrgent={onUrgent} />
    </>
  );
}
