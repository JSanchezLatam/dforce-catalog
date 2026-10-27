import type { ReactNode } from "react";

import { AgendaChip } from "@/modules/agenda/AgendaChip";
import type { AgendaItem } from "@/modules/agenda/items";

const dmy = (key: string) => `${key.slice(8)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;

/**
 * Every Vencida order, whatever the visible range. `total` is the true count from the query; `items` is
 * the capped list. `actions` is the slot for Reprogramar / No se presentó (WU8): nothing renders there until it is given.
 */
export function VencidasPanel({ items, total, truncated, actions }: { items: readonly AgendaItem[]; total: number; truncated: boolean; actions?: (item: AgendaItem) => ReactNode }) {
  return (
    <section aria-labelledby="vencidas-title" className="mt-6 flex flex-col gap-2">
      <h2 id="vencidas-title" className="text-base font-semibold">Vencidas ({total})</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin citas vencidas</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-1">
              <span className="text-xs tabular-nums text-muted-foreground">{dmy(item.dayKey)} {item.time}</span>
              <AgendaChip item={item} />
              {actions?.(item)}
            </li>
          ))}
        </ul>
      )}
      {truncated ? <p role="status" className="text-sm text-amber-700 dark:text-amber-300">Se muestran las primeras 500 citas vencidas.</p> : null}
    </section>
  );
}
