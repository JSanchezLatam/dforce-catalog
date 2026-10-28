/**
 * kanban/queries.ts - the kanban's reads: the board's own batched read model plus which orders the
 * viewer is assigned to. No session: the caller authorizes. The customer table is never touched
 * here; `queries.privacy.test.ts` enforces it on this file's text.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { workshopBoardData } from "@/modules/board/queries";
import type { BoardOrderRow, BoardSinceRow, BoardTechRow } from "@/modules/board/shape";
import { db } from "@/shared/db/client";
import { ordenTecnico, tecnico } from "@/shared/db/schema";
import type { KanbanViewer } from "./shape";

/**
 * One batched query: the viewer's ACTIVE roster row, left-joined to its assignments within `ids`.
 * `onRoster` is true whenever that row exists, even with no assignment among `ids`, so the
 * "Mis órdenes" chip survives an empty board. A deactivated roster row matches nothing.
 */
export async function viewerAssignments(userId: string, ids: string[]): Promise<KanbanViewer> {
  const rows = await db
    .select({ ordenId: ordenTecnico.ordenId })
    .from(tecnico)
    .leftJoin(ordenTecnico, and(eq(ordenTecnico.tecnicoId, tecnico.id), ids.length > 0 ? inArray(ordenTecnico.ordenId, ids) : sql`false`))
    .where(and(eq(tecnico.userId, userId), isNull(tecnico.deactivatedAt)));
  return { onRoster: rows.length > 0, ordenIds: rows.flatMap((r) => (r.ordenId === null ? [] : [r.ordenId])) };
}

export type KanbanData = { rows: BoardOrderRow[]; techs: BoardTechRow[]; since: BoardSinceRow[]; viewer: KanbanViewer };

export async function kanbanData(userId: string, now: Date = new Date()): Promise<KanbanData> {
  const board = await workshopBoardData(now);
  const viewer = await viewerAssignments(userId, board.rows.map((r) => r.id));
  return { ...board, viewer };
}
