import { CalendarDays, Ellipsis, User } from "lucide-react";
import Link from "next/link";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cardAlert } from "@/modules/board/alerts";
import { formatAge, formatBoardTime } from "@/modules/board/format";
import { AlertStrip, CardShell, CategoryTag, TechAvatars, TimeChip, UrgentBadge } from "@/modules/board/primitives";
import type { KanbanCard } from "./shape";

/** Read-only card: until the move actions land, the ⋯ menu offers only "Ver orden". */
export function KanbanCardView({ card, generatedAt }: { card: KanbanCard; generatedAt: string }) {
  const alert = cardAlert(card, generatedAt, card.missing);
  // `BoardRow.plate` holds the TV's "Sin vehículo"; the card wants null so it reads "Sin placa".
  const noVehicle = card.missing.includes("vehiculo");
  const hasTags = card.urgent || card.categoria !== null || card.mine;
  return (
    <CardShell
      plate={noVehicle ? null : card.plate}
      make={card.make}
      model={card.model}
      urgent={card.urgent}
      action={
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Acciones de la orden" className="-mt-1.5 -mr-1.5 grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted">
            <Ellipsis aria-hidden="true" className="size-4.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-40">
            <DropdownMenuItem className="min-h-11" render={<Link href={`/service-orders/${card.id}`} />}>Ver orden</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
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
