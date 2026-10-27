import { AgendaChip } from "@/modules/agenda/AgendaChip";
import { sortItems, type AgendaItem } from "@/modules/agenda/items";

/** One column of chips. The range query already holds exactly the selected day. */
export function DayView({ items }: { items: readonly AgendaItem[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">Sin citas para este día</p>;
  return (
    <ul className="flex flex-col gap-2">
      {sortItems(items).map((item) => (
        <li key={item.id}>
          <AgendaChip item={item} />
        </li>
      ))}
    </ul>
  );
}
