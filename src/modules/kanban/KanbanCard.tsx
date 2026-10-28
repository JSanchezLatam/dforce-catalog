"use client";

import { useDraggable } from "@dnd-kit/core";
import { CalendarDays, GripVertical, User } from "lucide-react";

import { cardAlert } from "@/modules/board/alerts";
import { formatAge, formatBoardTime } from "@/modules/board/format";
import { AlertStrip, CardShell, CategoryTag, TechAvatars, TimeChip, UrgentBadge } from "@/modules/board/primitives";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import { CardMenu } from "./CardMenu";
import type { KanbanCard } from "./shape";

export function KanbanCardView({ card, generatedAt, canMove, onMove, onUrgent }: { card: KanbanCard; generatedAt: string; canMove: boolean; onMove: (card: KanbanCard, target: OrderStatus) => void; onUrgent: (card: KanbanCard, on: boolean) => void }) {
  const alert = cardAlert(card, generatedAt, card.missing);
  // `BoardRow.plate` holds the TV's "Sin vehículo"; the card wants null so it reads "Sin placa".
  const noVehicle = card.missing.includes("vehiculo");
  const hasTags = card.urgent || card.categoria !== null || card.mine;
  // Works without a DndContext (before mount, standalone): dnd-kit's default context is inert there.
  const { setNodeRef, setActivatorNodeRef, listeners, isDragging } = useDraggable({ id: card.id, disabled: !canMove });
  return (
    <CardShell
      rootRef={setNodeRef}
      className={isDragging ? "opacity-40" : undefined}
      // The grip alone starts a drag: listeners on the card would also catch the portalled menu's presses (React bubbles
      // through portals). It is hidden below md, where the sheet replaces drag. `attributes` is never spread (D11b).
      grip={
        canMove ? (
          <span ref={setActivatorNodeRef} {...listeners} title="Arrastrar" className="-mt-1.5 -ml-3 grid size-11 shrink-0 cursor-grab touch-none place-items-center text-muted-foreground/60 max-md:hidden">
            <GripVertical aria-hidden="true" className="size-4" />
          </span>
        ) : undefined
      }
      plate={noVehicle ? null : card.plate}
      make={card.make}
      model={card.model}
      urgent={card.urgent}
      action={<CardMenu card={card} canMove={canMove} onMove={(target) => onMove(card, target)} onUrgent={(on) => onUrgent(card, on)} />}
      tags={
        hasTags ? (
          <>
            {card.urgent && <UrgentBadge />}
            <CategoryTag categoria={card.categoria} />
            {card.mine && (
              <span className="inline-flex items-center gap-1 rounded-md bg-foreground px-1.5 py-0.5 text-[11px] font-semibold text-background">
                <User aria-hidden="true" className="size-3" />
                Asignada a vos
              </span>
            )}
          </>
        ) : undefined
      }
      alert={alert ? <AlertStrip alert={alert} /> : undefined}
      footer={
        <>
          <TechAvatars names={card.technicians} />
          {card.status === "booked" && card.appointmentAt ? (
            <TimeChip icon={CalendarDays}>{formatBoardTime(card.appointmentAt)}</TimeChip>
          ) : (
            <TimeChip>{`hace ${formatAge(card.statusSince, generatedAt)}`}</TimeChip>
          )}
        </>
      }
    />
  );
}
