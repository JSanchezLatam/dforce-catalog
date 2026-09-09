import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { isServiceCategory } from "@/modules/service-orders/categories";
import { canEditOrderFields } from "@/modules/service-orders/edit-policy";
import { getOrdenServicioById } from "@/modules/service-orders/queries";
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

/** Generous for a technician's notes, finite for everyone else. */
const MAX_TEXT_LENGTH = 5000;

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

    // D11 — the fine-grained gate, run after the coarse
    // `can(user, "service-orders.write")` above, which BOTH roles pass
    // (policy.ts:30, :43). Field patches only: the status branch returned
    // already, so R21's state machine keeps owning status exclusively and this
    // gate never sees a status change request.
    //
    // The status is read from the RECORD, before the write — never from
    // `body.status`, which is a client claim, and one a tab rendered while the
    // order was still open will happily carry after someone else closed it.
    // Same reasoning as `isServiceCategory` being called here rather than
    // trusted from the form: the route is the trust boundary, the UI gate is
    // convenience. Accepted cost: `updateOrder` resolves the row again below,
    // so a permitted patch does two primary-key reads (design.md D11).
    const getById = deps.getById ?? getOrdenServicioById;
    const current = await getById(id);
    if (!current) {
      throw new OrdenServicioNotFoundError(id);
    }
    const { status } = current.orden;
    if (!canEditOrderFields(user.role, status)) {
      // Two answers, because the operator's next move differs: a técnico on an
      // open order must ask an admin (403, the caller is refused), while a
      // closed order refuses everyone (409 — the caller is permitted, the
      // record's state is what says no).
      if (status === "done" || status === "cancelled") {
        return NextResponse.json(
          { errors: { form: "No se puede editar una orden completada o cancelada." } },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { errors: { form: "Solo un administrador puede editar una orden abierta." } },
        { status: 403 },
      );
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
      // These are unbounded `text` columns and this PR tripled how many of them
      // a client can write. A type check alone lets any authenticated user
      // PATCH megabytes straight into Postgres.
      if (typeof body[field] === "string" && body[field].length > MAX_TEXT_LENGTH) {
        return NextResponse.json({ errors: { [field]: "Texto demasiado largo" } }, { status: 400 });
      }
      patch[field] = body[field];
    }
    if (body.appointmentAt !== undefined) {
      if (body.appointmentAt === null) {
        patch.appointmentAt = null;
      } else {
        // `new Date(garbage)` is an Invalid Date, not a throw. Beyond the 500 it
        // used to cause, `updateOrder` compares getTime() against the current
        // value to decide whether to reschedule reminders — NaN !== null, so an
        // Invalid Date reads as a CHANGED appointment and would cancel a real
        // pending reminder the moment the write stopped failing.
        const parsed = new Date(body.appointmentAt);
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json({ errors: { appointmentAt: "Fecha inválida" } }, { status: 400 });
        }
        patch.appointmentAt = parsed;
      }
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
