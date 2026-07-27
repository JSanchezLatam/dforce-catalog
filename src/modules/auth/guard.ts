import { NextResponse } from "next/server";

import { can, type Action } from "./policy";
import { requireSession } from "./session";

export function withAuthorization(
  action: Action,
  handler: (request: Request, ...args: unknown[]) => Promise<Response>,
) {
  return async (request: Request, ...args: unknown[]): Promise<Response> => {
    const user = requireSession(request);
    if (!can(user, action)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return handler(request, ...args);
  };
}
