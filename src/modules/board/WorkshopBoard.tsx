"use client";

import { CalendarDays } from "lucide-react";

import { ORDER_STATUS_LABEL } from "@/modules/service-orders/statuses";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import { cardAlert, type CardAlert } from "./alerts";
import { formatAge, formatBoardTime } from "./format";
import { AlertStrip, CardShell, ColumnShell, TechAvatars, TimeChip, UrgentBadge } from "./primitives";
import { StaleBanner } from "./StaleBanner";
import type { BoardRow, BoardSnapshot } from "./shape";
import { useBoardSnapshot } from "./useBoardSnapshot";

// Spec order. `cancelled` never reaches the board.
const COLUMNS: Exclude<OrderStatus, "cancelled">[] = ["booked", "open", "diagnosing", "in_progress", "on_hold", "ready_for_review", "done"];
// `BoardRow.plate` carries this literal for an order with no vehicle; the card reads it as "Sin placa" so the two lines differ.
const NO_VEHICLE = "Sin vehículo";

/** The one amber strip: the hold reason on its own (the age is the chip beside it), or an overdue appointment. */
function tvAlert(r: BoardRow, now: string): CardAlert | null {
  if (r.status === "on_hold") return r.holdReason ? { kind: "hold", text: r.holdReason } : null;
  return cardAlert(r, now);
}

/** Staff view: every open order by status. Read-only; props are plain serializable data. */
export function WorkshopBoard({ initial }: { initial: BoardSnapshot }) {
  const { snapshot, lastOkAt, now } = useBoardSnapshot("/api/board", initial);
  return (
    <>
      <StaleBanner lastOkAt={lastOkAt} now={now} />
      {/* The grid scrolls inside this wrapper so a phone never scrolls the page sideways. */}
      <div className="overflow-x-auto">
        <div className="grid min-w-[72rem] grid-cols-7 gap-4">
          {COLUMNS.map((status) => {
            const rows = snapshot.rows.filter((r) => r.status === status);
            return (
              <ColumnShell key={status} tv status={status} label={ORDER_STATUS_LABEL[status]} count={rows.length}>
                {rows.map((r, i) => {
                  const alert = tvAlert(r, snapshot.generatedAt);
                  return (
                    <CardShell
                      key={i}
                      tv
                      plate={r.plate === NO_VEHICLE ? null : r.plate}
                      make={r.make}
                      model={r.model}
                      urgent={r.urgent}
                      tags={r.urgent ? <UrgentBadge tv /> : undefined}
                      alert={alert ? <AlertStrip tv alert={alert} /> : undefined}
                      footer={
                        <>
                          <TechAvatars tv names={r.technicians} />
                          {status === "booked" && r.appointmentAt ? (
                            <TimeChip tv icon={CalendarDays}>{formatBoardTime(r.appointmentAt)}</TimeChip>
                          ) : (
                            <TimeChip tv>{formatAge(r.statusSince, snapshot.generatedAt)}</TimeChip>
                          )}
                        </>
                      }
                    />
                  );
                })}
              </ColumnShell>
            );
          })}
        </div>
      </div>
    </>
  );
}
