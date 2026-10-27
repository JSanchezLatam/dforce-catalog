import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { customerBoardOrders } from "@/modules/board/queries";
import { toCustomerSnapshot, type BoardOrderRow } from "@/modules/board/shape";

/** Poll route of the waiting-room view. `can()` runs before anything is queried; failures are JSON, never HTML. */
export async function handleCustomerBoard(
  request: NextRequest,
  deps: { load?: (now: Date) => Promise<BoardOrderRow[]>; now?: () => Date } = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "board.customer")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const now = (deps.now ?? (() => new Date()))();
  try {
    const rows = await (deps.load ?? customerBoardOrders)(now);
    return NextResponse.json(toCustomerSnapshot(rows, now), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Board unavailable" }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleCustomerBoard(request);
}
