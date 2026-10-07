import { invalid, reply, withToken } from "../../../../src/portal/http";
import { findByToken } from "../../../../src/portal/lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (request: Request) =>
  withToken(request, async (token) => {
    const found = await findByToken(token);
    return found ? reply(200, { state: found.accepted ? "accepted" : "terms" }) : invalid();
  });
