import { NoShowConfirm } from "@/modules/agenda/NoShowConfirm";
import { ReprogramDialog } from "@/modules/agenda/ReprogramDialog";
import type { AgendaItem } from "@/modules/agenda/items";

/** The two actions of an appointment; each decides for itself whether the item qualifies. */
export function ItemActions({ item }: { item: AgendaItem }) {
  if (item.muted) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <ReprogramDialog item={item} />
      <NoShowConfirm item={item} />
    </div>
  );
}
