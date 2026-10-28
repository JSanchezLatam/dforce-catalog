import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { OrderClosedError } from "@/modules/service-orders/order-lock";
import { orderScope } from "@/modules/service-orders/scope";
import { OrdenServicioNotFoundError } from "@/modules/service-orders/service";
import { setUrgent } from "@/modules/service-orders/urgent";

export type UrgentRouteDeps = { set?: typeof setUrgent };

async function handle(request: NextRequest, ordenId: string, on: boolean, deps: UrgentRouteDeps): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "service-orders.assign")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json(await (deps.set ?? setUrgent)(ordenId, on, { scope: orderScope(user), actorId: user.id }));
  } catch (err) {
    if (err instanceof OrdenServicioNotFoundError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    // Never correctable: no `attemptWithCorrection`, so a password in the body is never read.
    if (err instanceof OrderClosedError) {
      return NextResponse.json(
        { error: "order_closed", message: "La orden está cerrada y ya no se puede cambiar si es urgente." },
        { status: 409 },
      );
    }
    throw err;
  }
}

export const handleSet = (request: NextRequest, ordenId: string, deps: UrgentRouteDeps = {}) =>
  handle(request, ordenId, true, deps);
export const handleClear = (request: NextRequest, ordenId: string, deps: UrgentRouteDeps = {}) =>
  handle(request, ordenId, false, deps);

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Context): Promise<NextResponse> {
  return handleSet(request, (await params).id);
}

export async function DELETE(request: NextRequest, { params }: Context): Promise<NextResponse> {
  return handleClear(request, (await params).id);
}
