import { clearedCookie, requireSupport } from "../../../../src/support/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  if (!(await requireSupport())) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store", "Set-Cookie": clearedCookie() } });
}
