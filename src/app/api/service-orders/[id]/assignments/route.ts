import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { assignTecnico, InvalidTecnicoError } from "@/modules/service-orders/assignments";
import { OrderClosedError } from "@/modules/service-orders/order-lock";
import { orderScope } from "@/modules/service-orders/scope";
import { OrdenServicioNotFoundError } from "@/modules/service-orders/service";

export type AssignDeps = { assign?: typeof assignTecnico };

/** One technician per request. Never deletes: there is no un-assign. */
export async function handleAssign(request: NextRequest, ordenId: string, deps: AssignDeps = {}): Promise<NextResponse> {
  const user = requireSession(request);
  // 403 before any lookup, so a técnico cannot probe which orders exist.
  if (!can(user, "service-orders.assign")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const tecnicoId = body?.tecnicoId;
  if (typeof tecnicoId !== "string" || tecnicoId === "") {
    return NextResponse.json({ errors: { tecnicoId: "Elegí un técnico" } }, { status: 400 });
  }

  try {
    // No `attemptWithCorrection`: a closed order is never assignable, so a password is never read.
    const { created } = await (deps.assign ?? assignTecnico)({
      ordenId,
      tecnicoId,
      assignedBy: user.id,
      scope: orderScope(user),
    });
    return NextResponse.json({ created }, { status: created ? 201 : 200 });
  } catch (err) {
    if (err instanceof OrdenServicioNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (err instanceof OrderClosedError) {
      return NextResponse.json(
        { error: "order_closed", message: "No se puede asignar un técnico a una orden completada o cancelada." },
        { status: 409 },
      );
    }
    if (err instanceof InvalidTecnicoError) {
      return NextResponse.json({ errors: { tecnicoId: "Elegí un técnico activo" } }, { status: 400 });
    }
    throw err;
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  return handleAssign(request, id);
}
