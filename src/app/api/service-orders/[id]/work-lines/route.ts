import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { orderScope } from "@/modules/service-orders/scope";
import { addWorkLine } from "@/modules/service-orders/work-lines";
import { attemptWithCorrection, type Authorize } from "../../correction-http";
import { workLineErrorResponse } from "./errors";

export type AddWorkLineDeps = { add?: typeof addWorkLine; authorize?: Authorize };

export async function handleAddWorkLine(request: NextRequest, ordenId: string, deps: AddWorkLineDeps = {}): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "service-orders.write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // `assign` marks staff (admin, jefe): they write any assigned technician's line. `correct` decides whether a password is verified.
  const canManageAll = can(user, "service-orders.assign");
  const canCorrect = can(user, "service-orders.correct");

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return NextResponse.json({ errors: { form: "No se pudo leer el pedido" } }, { status: 400 });
  }
  if (typeof body.tecnicoId !== "string" || body.tecnicoId === "") {
    return NextResponse.json({ errors: { tecnicoId: "Elegí un técnico" } }, { status: 400 });
  }

  try {
    const add = deps.add ?? addWorkLine;
    const { id } = await attemptWithCorrection(
      user,
      canCorrect,
      typeof body.password === "string" ? body.password : undefined,
      (correction) =>
        add({
          ordenId,
          tecnicoId: body.tecnicoId,
          descripcion: body.descripcion,
          duracionMinutos: body.duracionMinutos,
          fecha: body.fecha,
          actor: { id: user.id, canManageAll },
          scope: orderScope(user),
          ...(correction && { correction }),
        }),
      deps.authorize,
    );
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    const refused = workLineErrorResponse(err, canCorrect);
    if (refused) return refused;
    throw err;
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  return handleAddWorkLine(request, id);
}
