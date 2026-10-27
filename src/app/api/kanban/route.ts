import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { kanbanData, type KanbanData } from "@/modules/kanban/queries";
import { toKanbanSnapshot } from "@/modules/kanban/shape";

/** Poll route of the kanban. `can()` runs before anything is queried; failures are JSON, never HTML. */
export async function handleKanban(
  request: NextRequest,
  deps: {
    load?: (userId: string, now: Date) => Promise<KanbanData>;
    now?: () => Date;
  } = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "board.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const now = (deps.now ?? (() => new Date()))();
  try {
    const { viewer, ...board } = await (deps.load ?? kanbanData)(user.id, now);
    return NextResponse.json(toKanbanSnapshot(board, viewer, now), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Kanban unavailable" }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleKanban(request);
}
