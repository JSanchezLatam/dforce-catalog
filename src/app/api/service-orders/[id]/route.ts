import { NextResponse, type NextRequest } from "next/server";

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

/**
 * R21 — update a service order. A `status` field in the body drives a
 * transition (delegates to `transitionOrder`, which also handles R23's
 * reminder scheduling/cancellation); any other body drives a plain field
 * edit (`description`/`appointmentAt`) via `updateOrder`. One PATCH route,
 * per design.md §7's route table — same `handleX` DI split as the customer
 * routes and `manual/route.ts`.
 */
export async function handleUpdateOrdenServicio(
  request: NextRequest,
  id: string,
  deps: UpdateOrdenServicioRouteDeps = {},
): Promise<NextResponse> {
  requireSession(request);

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
