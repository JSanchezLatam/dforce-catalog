import { STATUS_LABELS, type Status } from "../../../../../src/support/format";
import { isUuid, updateFeedback } from "../../../../../src/support/queries";
import { requireSupport } from "../../../../../src/support/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOTE_MAX = 2000;
const HEADERS = { "Cache-Control": "no-store" };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers: HEADERS });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await requireSupport())) return fail(401, "unauthorized");

  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) return fail(400, "invalid_body");
  const keys = Object.keys(body);
  if (!keys.length || keys.some((k) => k !== "status" && k !== "note")) return fail(400, "invalid_body");
  const { status, note } = body as { status?: unknown; note?: unknown };

  if (status !== undefined && !(typeof status === "string" && Object.hasOwn(STATUS_LABELS, status))) return fail(400, "invalid_status");
  if (note !== undefined && !(typeof note === "string" && note.length <= NOTE_MAX)) return fail(400, "invalid_note");

  const { id } = await params;
  if (!isUuid(id)) return fail(404, "not_found");
  const found = await updateFeedback(id, { ...(status !== undefined && { status: status as Status }), ...(note !== undefined && { note }) });
  return found ? Response.json({ ok: true }, { headers: HEADERS }) : fail(404, "not_found");
}
