/**
 * kanban/shape.ts - the only mapper that emits an order `id`, `missing` and `mine`. It builds each
 * card field by field on top of `boardFields` and never spreads a source row; the TV mappers in
 * `board/shape.ts` stay free of all three. No customer data is selected upstream, so none can leak.
 */
import { boardFields, compareRows, type BoardOrderRow, type BoardRow, type BoardSinceRow, type BoardTechRow } from "@/modules/board/shape";
import type { ServiceCategory } from "@/modules/service-orders/categories";

export type KanbanCard = BoardRow & {
  id: string;
  categoria: ServiceCategory | null;
  /** What a `booked` order still lacks before it can be received. */
  missing: ("vehiculo" | "categoria")[];
  /** The viewer is an active technician assigned to this order. */
  mine: boolean;
};
export type KanbanSnapshot = { generatedAt: string; onRoster: boolean; rows: KanbanCard[] };
/** What `viewerAssignments` returns. */
export type KanbanViewer = { onRoster: boolean; ordenIds: string[] };

export function toKanbanSnapshot(
  data: { rows: BoardOrderRow[]; techs: BoardTechRow[]; since: BoardSinceRow[] },
  viewer: KanbanViewer,
  now: Date,
): KanbanSnapshot {
  const sinceById = new Map(data.since.map((s) => [s.ordenId, s.changedAt]));
  const mine = new Set(viewer.ordenIds);
  const cards = data.rows.map((r): KanbanCard => {
    const missing: KanbanCard["missing"] = [];
    if (r.vehiculoId === null) missing.push("vehiculo");
    if (r.categoria === null) missing.push("categoria");
    return { id: r.id, ...boardFields(r, data.techs, sinceById), categoria: r.categoria, missing, mine: mine.has(r.id) };
  });
  cards.sort(compareRows);
  return { generatedAt: now.toISOString(), onRoster: viewer.onRoster, rows: cards };
}
