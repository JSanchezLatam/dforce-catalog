import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { ClienteDeactivatedError } from "@/modules/customers/service";
import {
  createOrder,
  type CreateOrdenServicioDeps,
  InvalidCategoriaError,
  InvalidVehiculoError,
  UnknownClienteError,
} from "@/modules/service-orders/service";

export async function handleCreateOrdenServicio(
  request: NextRequest,
  deps: CreateOrdenServicioDeps = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "service-orders.write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  try {
    // Follow-up 1.18. `createdBy` comes from the SESSION, never from the
    // body — spreading it AFTER `body` is what makes a client-supplied value
    // unable to win. The route is the only place that knows who is acting;
    // everything the body says about identity is a claim, not a fact.
    const orden = await createOrder({ ...body, createdBy: user.id }, deps);
    return NextResponse.json({ orden }, { status: 201 });
  } catch (err) {
    if (err instanceof ClienteDeactivatedError) {
      // 409, matching `api/customers/[id]` — the caller is permitted, the
      // RECORD's state is what refuses. A 400 would read as a malformed body.
      return NextResponse.json({ error: "cliente_deactivated" }, { status: 409 }); // R20/D5
    }
    if (err instanceof UnknownClienteError) {
      return NextResponse.json({ error: "unknown_cliente", clienteId: err.clienteId }, { status: 400 }); // R20
    }
    if (err instanceof InvalidCategoriaError) {
      return NextResponse.json({ errors: err.errors }, { status: 400 }); // C4
    }
    if (err instanceof InvalidVehiculoError) {
      return NextResponse.json({ errors: err.errors }, { status: 400 }); // C4
    }
    throw err;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleCreateOrdenServicio(request);
}
