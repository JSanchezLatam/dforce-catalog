import { recordAcceptance } from "../../../../src/portal/accept";
import { invalid, reply, withToken } from "../../../../src/portal/http";
import { findByToken } from "../../../../src/portal/lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (request: Request) =>
  withToken(request, async (token) => {
    const found = await findByToken(token);
    if (!found) return invalid();
    // The acceptance is stored BEFORE the data leaves.
    await recordAcceptance(token);
    return reply(200, { state: "accepted", snapshot: found.snapshot });
  });
