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

/** Nullable `text` columns this route accepts, all guarded the same way. */
const NULLABLE_TEXT_FIELDS = ["description", "hallazgos", "recomendaciones", "observaciones"] as const;

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
    // Every text column reached through this route, guarded in one place. The
    // enum field below can lean on a PG cast if this misses; these cannot, so
    // leaving them to `string | null` — a claim about the body, not a fact
    // about it — was the weaker half getting the weaker treatment.
    for (const field of NULLABLE_TEXT_FIELDS) {
      if (body[field] === undefined) continue;
      if (body[field] !== null && typeof body[field] !== "string") {
        return NextResponse.json({ errors: { [field]: "Valor inválido" } }, { status: 400 }); // C4
      }
      patch[field] = body[field];
    }
    if (body.appointmentAt !== undefined) {
      patch.appointmentAt = body.appointmentAt === null ? null : new Date(body.appointmentAt);
    }
    if (body.categoria !== undefined) {
      if (!isServiceCategory(body.categoria)) {
        return NextResponse.json({ errors: { categoria: "Elegí un tipo de servicio válido" } }, { status: 400 }); // C4
      }
      patch.categoria = body.categoria;
    }

    // A body of nothing but unrecognised fields whitelists down to `{}`, and
    // `.set({})` is either a driver error or a SET-less UPDATE — a 500 either
    // way, for a request that deserves an answer. Pre-existing; this is the PR
    // that turned "read the body freely, drop the rest" into a pinned contract.
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ errors: { form: "No hay cambios para guardar" } }, { status: 400 });
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
