"use client";

import { ORDER_STATUS_LABEL } from "@/modules/service-orders/statuses";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import { StatusBadge } from "@/shared/ui/StatusBadge";
import { formatAge, formatBoardTime } from "./format";
import { StaleBanner } from "./StaleBanner";
import type { BoardSnapshot } from "./shape";
import { useBoardSnapshot } from "./useBoardSnapshot";

// Spec order. `cancelled` never reaches the board.
const COLUMNS: OrderStatus[] = ["booked", "open", "diagnosing", "in_progress", "on_hold", "ready_for_review", "done"];

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
          const label = ORDER_STATUS_LABEL[status];
          const rows = snapshot.rows.filter((r) => r.status === status);
          return (
            <section key={status} aria-label={label} className="flex flex-col gap-3">
              <h2 className="text-2xl font-bold">{label}</h2>
              <ul className="flex flex-col gap-3">
                {rows.map((r, i) => (
                  <li key={i} className="flex flex-col gap-1 rounded-xl border bg-card p-3">
                    <div className="text-2xl font-bold tracking-wide">{r.plate}</div>
                    {(r.make || r.model) && <div className="text-lg text-muted-foreground">{[r.make, r.model].filter(Boolean).join(" ")}</div>}
                    <StatusBadge status={status} label={r.statusLabel} className="self-start px-3 py-1 text-base" />
                    {status === "on_hold" && r.holdReason && <div className="text-lg">{r.holdReason}</div>}
                    {status === "booked" && r.appointmentAt && <div className="text-lg">{formatBoardTime(r.appointmentAt)}</div>}
                    {r.technicians.length > 0 && <div className="text-lg">{r.technicians.join(", ")}</div>}
                    <div className="text-lg text-muted-foreground">{formatAge(r.statusSince, snapshot.generatedAt)}</div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      </div>
    </>
  );
}
