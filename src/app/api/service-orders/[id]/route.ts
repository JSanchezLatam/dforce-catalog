import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { isServiceCategory } from "@/modules/service-orders/categories";
import { requireSession } from "@/modules/auth/session";
import {
  OrdenServicioNotFoundError,
  updateOrder,
  transitionOrder,
  type TransitionOrdenServicioDeps,
  type UpdateOrdenServicioDeps,
  type UpdateOrdenServicioPatch,
} from "@/modules/service-orders/service";
import { OrderTransitionError, type OrderStatus } from "@/modules/service-orders/transitions";

export type UpdateOrdenServicioRouteDeps = UpdateOrdenServicioDeps & TransitionOrdenServicioDeps;

export async function handleUpdateOrdenServicio(
  request: NextRequest,
  id: string,
  deps: UpdateOrdenServicioRouteDeps = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "service-orders.write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  try {
    if (typeof body.status === "string") {
      const orden = await transitionOrder(id, body.status as OrderStatus, deps);
      return NextResponse.json({ orden });
    }

    const patch: UpdateOrdenServicioPatch = {};
    if (body.description !== undefined) patch.description = body.description;
    if (body.appointmentAt !== undefined) {
      patch.appointmentAt = body.appointmentAt === null ? null : new Date(body.appointmentAt);
    }
    if (body.categoria !== undefined) {
      if (!isServiceCategory(body.categoria)) {
        return NextResponse.json({ errors: { categoria: "Elegí un tipo de servicio válido" } }, { status: 400 }); // C4
      }
      patch.categoria = body.categoria;
    }
    if (body.hallazgos !== undefined) patch.hallazgos = body.hallazgos;
    if (body.recomendaciones !== undefined) patch.recomendaciones = body.recomendaciones;
    if (body.observaciones !== undefined) patch.observaciones = body.observaciones;

    const orden = await updateOrder(id, patch, deps);
    return NextResponse.json({ orden });
  } catch (err) {
    if (err instanceof OrderTransitionError) {
      return NextResponse.json({ error: "invalid_transition", from: err.from, to: err.to }, { status: 400 }); // R21
    }
    if (err instanceof OrdenServicioNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handleUpdateOrdenServicio(request, id);
}
