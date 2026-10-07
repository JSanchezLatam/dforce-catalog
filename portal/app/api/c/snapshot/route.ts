import { invalid, reply, withToken } from "../../../../src/portal/http";
import { findByToken } from "../../../../src/portal/lookup";
import { TERMS_GATE_ENABLED } from "../../../../src/terms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (request: Request) =>
  withToken(request, async (token) => {
    const found = await findByToken(token);
    if (!found) return invalid();
    return found.accepted || !TERMS_GATE_ENABLED ? reply(200, { state: "accepted", snapshot: found.snapshot }) : reply(200, { state: "terms" });
  });
