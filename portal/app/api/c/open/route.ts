import { invalid, reply, withToken } from "../../../../src/portal/http";
import { findByToken } from "../../../../src/portal/lookup";
import { TERMS_GATE_ENABLED } from "../../../../src/terms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (request: Request) =>
  withToken(request, async (token) => {
    const found = await findByToken(token);
    return found ? reply(200, { state: found.accepted || !TERMS_GATE_ENABLED ? "accepted" : "terms" }) : invalid();
  });
