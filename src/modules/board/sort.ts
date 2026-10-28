/** board/sort.ts - in-column card order, pure so the client can re-sort after an optimistic override. */
export type ColumnSortable = { urgent: boolean; statusSince: string };

/** Urgent cards first, then the longest time in status first. */
export const compareInColumn = (a: ColumnSortable, b: ColumnSortable): number =>
  Number(b.urgent) - Number(a.urgent) || Date.parse(a.statusSince) - Date.parse(b.statusSince);
