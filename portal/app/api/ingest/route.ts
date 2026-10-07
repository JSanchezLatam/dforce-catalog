import { verify } from "../../../src/contract";
import { applyIngest } from "../../../src/ingest/apply";
import { parseIngest } from "../../../src/ingest/parse";

// node:crypto in the contract: not the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reply = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function handle(request: Request): Promise<Response> {
  const secret = process.env.PORTAL_INGEST_SECRET;
  const raw = await request.text();
  // Authenticate BEFORE looking at the body. No secret configured fails closed.
  if (!secret || !verify(raw, request.headers, secret)) return reply(401, { error: "unauthorized" });
  if (request.method !== "POST") return reply(405, { error: "method not allowed" });

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return reply(400, { error: "invalid body" });
  }
  const parsed = parseIngest(json);
  if (!parsed.ok) return reply(400, { error: "invalid body" });
  return reply(200, await applyIngest(parsed.body));
}

// Every method is answered by the same gate, so none is reachable unsigned.
export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
