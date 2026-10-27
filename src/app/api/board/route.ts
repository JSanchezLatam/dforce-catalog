import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { workshopBoardData } from "@/modules/board/queries";
import { toBoardSnapshot, type BoardOrderRow, type BoardSinceRow, type BoardTechRow } from "@/modules/board/shape";

/** Poll route of the full board. `can()` runs before anything is queried; failures are JSON, never HTML. */
export async function handleBoard(
  request: NextRequest,
  deps: {
    load?: (now: Date) => Promise<{ rows: BoardOrderRow[]; techs: BoardTechRow[]; since: BoardSinceRow[] }>;
    now?: () => Date;
  } = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "board.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const now = (deps.now ?? (() => new Date()))();
  try {
    const { rows, techs, since } = await (deps.load ?? workshopBoardData)(now);
    return NextResponse.json(toBoardSnapshot(rows, techs, since, now), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Board unavailable" }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleBoard(request);
}
