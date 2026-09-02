import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { isServiceCategory } from "@/modules/service-orders/categories";
import { requireSession } from "@/modules/auth/session";
import {
  createOrder,
  type CreateOrdenServicioDeps,
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
  if (!isServiceCategory(body?.categoria)) {
    return NextResponse.json({ errors: { categoria: "Elegí un tipo de servicio válido" } }, { status: 400 }); // C4
  }

  try {
    const orden = await createOrder(body, deps);
    return NextResponse.json({ orden }, { status: 201 });
  } catch (err) {
    if (err instanceof UnknownClienteError) {
      return NextResponse.json({ error: "unknown_cliente", clienteId: err.clienteId }, { status: 400 }); // R20
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
