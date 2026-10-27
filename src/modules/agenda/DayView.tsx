import { DayBooking } from "@/modules/agenda/AgendaBookingForm";
import { AgendaChip } from "@/modules/agenda/AgendaChip";
import { sortItems, type AgendaItem } from "@/modules/agenda/items";

/** One column of chips. The range query already holds exactly the selected day. */
export function DayView({ items, date }: { items: readonly AgendaItem[]; date?: string }) {
  return (
    <div className="flex flex-col gap-2">
      {date ? <DayBooking day={date} /> : null}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin citas para este día</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sortItems(items).map((item) => (
            <li key={item.id}>
              <AgendaChip item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
