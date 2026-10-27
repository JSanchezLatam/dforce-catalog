"use client";

import { StatusBadge, type BadgeStatus } from "@/shared/ui/StatusBadge";
import { StaleBanner } from "./StaleBanner";
import type { CustomerSnapshot } from "./shape";
import { useBoardSnapshot } from "./useBoardSnapshot";

// The customer-facing labels `CUSTOMER_STATUS` produces, mapped to a badge family.
const COLUMNS: { label: string; badge: BadgeStatus }[] = [
  { label: "Recibida", badge: "open" },
  { label: "En proceso", badge: "in_progress" },
  { label: "Terminada", badge: "done" },
];
const MAX_ROWS = 12;

/** Waiting-room view: plate, vehicle and status only. Props are plain serializable data. */
export function CustomerBoard({ initial }: { initial: CustomerSnapshot }) {
  const { snapshot, lastOkAt, failedAt } = useBoardSnapshot("/api/board/clientes", initial);
  return (
    <>
      <StaleBanner lastOkAt={lastOkAt} failedAt={failedAt} />
      <div className="grid grid-cols-3 gap-6">
        {COLUMNS.map(({ label, badge }) => {
          const rows = snapshot.rows.filter((r) => r.status === label);
          return (
            <section key={label} aria-label={label} className="flex flex-col gap-3">
              <h2 className="text-3xl font-bold">{label}</h2>
              <ul className="flex flex-col gap-3">
                {rows.slice(0, MAX_ROWS).map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4">
                    <div>
                      <div className="text-3xl font-bold tracking-wide">{r.plate}</div>
                      <div className="text-xl text-muted-foreground">{[r.make, r.model].filter(Boolean).join(" ")}</div>
                    </div>
                    <StatusBadge status={badge} label={label} className="px-3 py-1 text-base" />
                  </li>
                ))}
              </ul>
              {rows.length > MAX_ROWS && <p className="text-xl text-muted-foreground">{`+${rows.length - MAX_ROWS} más`}</p>}
            </section>
          );
        })}
      </div>
    </>
  );
}
