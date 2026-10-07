import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { orderScope } from "@/modules/service-orders/scope";
import { deleteWorkLine, updateWorkLine } from "@/modules/service-orders/work-lines";
import { attemptWithCorrection, type Authorize } from "../../../correction-http";
import { workLineErrorResponse } from "../errors";

type Ids = { ordenId: string; lineId: string };
type Context = { params: Promise<{ id: string; lineId: string }> };

export type UpdateWorkLineDeps = { update?: typeof updateWorkLine; authorize?: Authorize };
export type DeleteWorkLineDeps = { remove?: typeof deleteWorkLine; authorize?: Authorize };

export async function handleUpdateWorkLine(request: NextRequest, ids: Ids, deps: UpdateWorkLineDeps = {}): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "service-orders.write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const canManageAll = can(user, "service-orders.assign");
  const canCorrect = can(user, "service-orders.correct");

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return NextResponse.json({ errors: { form: "No se pudo leer el pedido" } }, { status: 400 });
  }

  try {
    const update = deps.update ?? updateWorkLine;
    await attemptWithCorrection(
      user,
      canCorrect,
      typeof body.password === "string" ? body.password : undefined,
      (correction) =>
        update({
          ...ids,
          // Only these three: the line's technician and order are never taken from the body.
          patch: { descripcion: body.descripcion, duracionMinutos: body.duracionMinutos, fecha: body.fecha },
          actor: { id: user.id, canManageAll },
          scope: orderScope(user),
          ...(correction && { correction }),
        }),
      deps.authorize,
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    const refused = workLineErrorResponse(err, canCorrect);
    if (refused) return refused;
    throw err;
  }
}

export async function handleDeleteWorkLine(request: NextRequest, ids: Ids, deps: DeleteWorkLineDeps = {}): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "service-orders.write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const canManageAll = can(user, "service-orders.assign");
  const canCorrect = can(user, "service-orders.correct");

  // The client may send no body: an unreadable one means "no password", not a 500.
  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : undefined;

  try {
    const remove = deps.remove ?? deleteWorkLine;
    await attemptWithCorrection(
      user,
      canCorrect,
      password,
      (correction) =>
        remove({ ...ids, actor: { id: user.id, canManageAll }, scope: orderScope(user), ...(correction && { correction }) }),
      deps.authorize,
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    const refused = workLineErrorResponse(err, canCorrect);
    if (refused) return refused;
    throw err;
  }
}

export async function PATCH(request: NextRequest, { params }: Context): Promise<NextResponse> {
  const { id, lineId } = await params;
  return handleUpdateWorkLine(request, { ordenId: id, lineId });
}

export async function DELETE(request: NextRequest, { params }: Context): Promise<NextResponse> {
  const { id, lineId } = await params;
  return handleDeleteWorkLine(request, { ordenId: id, lineId });
}
