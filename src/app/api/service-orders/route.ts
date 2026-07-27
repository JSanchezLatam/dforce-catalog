import { NextResponse, type NextRequest } from "next/server";

import { requireSession } from "@/modules/auth/session";
import { createOrder, type CreateOrdenServicioDeps, UnknownClienteError } from "@/modules/service-orders/service";

/**
 * R20 — create an `orden_servicio` + its line items. `createOrder` (Phase 3)
 * already does the all-or-nothing transaction and the R23 (Phase 4) reminder
 * scheduling side effect when `appointmentAt` is set; this route is a thin
 * auth+DI shell, same `handleX` split as `manual/route.ts`.
 */
export async function handleCreateOrdenServicio(
  request: NextRequest,
  deps: CreateOrdenServicioDeps = {},
): Promise<NextResponse> {
  requireSession(request);

  const body = await request.json();
  try {
    const orden = await createOrder(body, deps);
    return NextResponse.json({ orden }, { status: 201 });
  } catch (err) {
    if (err instanceof UnknownClienteError) {
      return NextResponse.json({ error: "unknown_cliente", clienteId: err.clienteId }, { status: 400 }); // R20
    }
    throw err;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleCreateOrdenServicio(request);
}
