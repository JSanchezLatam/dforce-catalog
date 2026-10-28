import { AgendaCard } from "@/modules/agenda/AgendaCard";
import type { AgendaItem } from "@/modules/agenda/items";

const dmy = (key: string) => `${key.slice(8)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;

/**
 * Every Vencida order, whatever the visible range, in the order given (the query sends oldest first). A plain
 * component: the shell filters the rows and owns the selection. The rows are cards, so the Detail opens from them.
 */
export function VencidasList({ items, empty, truncated, selectedId, onSelect }: { items: readonly AgendaItem[]; empty: string; truncated: boolean; selectedId: string | null; onSelect: (item: AgendaItem, anchor: HTMLElement) => void }) {
  return (
    <section aria-label="Citas vencidas" className="flex flex-col gap-2">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-1">
              <span className="text-xs tabular-nums text-muted-foreground">{dmy(item.dayKey)} {item.time}</span>
              <AgendaCard item={item} selected={item.id === selectedId} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}
      {truncated ? <p role="status" className="text-sm text-amber-700 dark:text-amber-300">Se muestran las primeras 500 citas vencidas.</p> : null}
    </section>
  );
}
