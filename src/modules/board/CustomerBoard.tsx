"use client";

import { Car } from "lucide-react";

import { StatusBadge } from "@/shared/ui/StatusBadge";
import { ColumnShell } from "./primitives";
import { StaleBanner } from "./StaleBanner";
import type { PortalOrder } from "@portal/contract";
import type { CustomerSnapshot } from "./shape";
import { useBoardSnapshot } from "./useBoardSnapshot";

// The customer-facing labels `CUSTOMER_STATUS` produces, mapped to a badge family.
const COLUMNS: { label: PortalOrder["status"]; badge: "open" | "in_progress" | "done" }[] = [
  { label: "Recibida", badge: "open" },
  { label: "En proceso", badge: "in_progress" },
  { label: "Terminada", badge: "done" },
];
// 8 rows (~112 px each) plus header and "+N más" fit a 1080 px TV; 12 measured 1444 px.
const MAX_ROWS = 8;

/** Waiting-room view: plate, vehicle and status only. Props are plain serializable data. */
export function CustomerBoard({ initial }: { initial: CustomerSnapshot }) {
  const { snapshot, lastOkAt, now } = useBoardSnapshot("/api/board/clientes", initial);
  return (
    <>
      <StaleBanner lastOkAt={lastOkAt} now={now} />
      <div className="grid grid-cols-3 gap-6">
        {COLUMNS.map(({ label, badge }) => {
          const rows = snapshot.rows.filter((r) => r.status === label);
          return (
            <ColumnShell key={label} tv status={badge} label={label} count={rows.length} more={rows.length > MAX_ROWS ? `+${rows.length - MAX_ROWS} más` : undefined}>
              {rows.slice(0, MAX_ROWS).map((r, i) => {
                const vehicle = [r.make, r.model].filter(Boolean).join(" ");
                return (
                  <li key={i} className="flex items-center justify-between gap-3 rounded-2xl border bg-board-tile p-4 shadow-(--board-tile-shadow)">
                    <div className="min-w-0">
                      <div className="truncate text-[28px] leading-8 font-extrabold tracking-wider tabular-nums">{r.plate}</div>
                      {vehicle && (
                        <div className="mt-0.5 flex items-center gap-2 text-xl text-muted-foreground">
                          <Car aria-hidden="true" className="size-5 shrink-0" />
                          <span className="truncate">{vehicle}</span>
                        </div>
                      )}
                    </div>
                    <StatusBadge status={badge} label={label} className="px-3 py-1 text-base" />
                  </li>
                );
              })}
            </ColumnShell>
          );
        })}
      </div>
    </>
  );
}
