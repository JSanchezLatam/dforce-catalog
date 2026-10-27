import { NoShowConfirm } from "@/modules/agenda/NoShowConfirm";
import { ReprogramDialog } from "@/modules/agenda/ReprogramDialog";
import type { AgendaItem } from "@/modules/agenda/items";

/** The two actions of an appointment; each decides for itself whether the item qualifies. `onSuccess` fires after a saved change, never after a refusal. */
export function ItemActions({ item, onSuccess }: { item: AgendaItem; onSuccess?: () => void }) {
  if (item.muted) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <ReprogramDialog item={item} onSuccess={onSuccess} />
      <NoShowConfirm item={item} onSuccess={onSuccess} />
    </div>
  );
}
