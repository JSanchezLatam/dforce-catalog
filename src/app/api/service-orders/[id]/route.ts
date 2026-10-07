import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { isServiceCategory } from "@/modules/service-orders/categories";
import { authorizeCorrection, CorrectionRefusedError } from "@/modules/service-orders/correction-auth";
import { parseIntake } from "@/modules/service-orders/intake";
import { OrderClosedError, OrderEditForbiddenError, type CorrectionGrant } from "@/modules/service-orders/order-lock";
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

export type UpdateOrdenServicioRouteDeps = Omit<UpdateOrdenServicioDeps, "role" | "correction"> &
  TransitionOrdenServicioDeps & {
    /** Injected so a test never runs bcrypt; defaults to the real re-authentication. */
    authorize?: (userId: string, password: string) => Promise<CorrectionGrant>;
  };

/**
 * `Retry-After` for a throttled correction: the full window. The exact wait is
 * "until the oldest failure ages out", which the throttle does not expose; the
 * window is the honest upper bound.
 */
const RETRY_AFTER_SECONDS = "900";

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
  const { authorize = authorizeCorrection, ...serviceDeps } = deps;
  try {
    if (typeof body.status === "string") {
      const orden = await transitionOrder(id, body.status as OrderStatus, serviceDeps);
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

    const intake = parseIntake(body);
    if (!intake.ok) {
      return NextResponse.json({ errors: intake.errors }, { status: 400 });
    }
    Object.assign(patch, intake.value);

    // A body of nothing but unrecognised fields whitelists down to `{}`, and
    // `.set({})` is either a driver error or a SET-less UPDATE — a 500 either
    // way, for a request that deserves an answer. Pre-existing; this is the PR
    // that turned "read the body freely, drop the rest" into a pinned contract.
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ errors: { form: "No hay cambios para guardar" } }, { status: 400 });
    }

    // The password is verified here, outside the transaction (bcrypt must not
    // hold the row lock), and only after the body validated. A tecnico's is never
    // verified. Whether the order is closed is decided by the service, under the
    // lock: on an open order the grant is simply not used.
    const password = typeof body.password === "string" ? body.password : undefined;
    const correction =
      password !== undefined && can(user, "service-orders.correct") ? await authorize(user.id, password) : undefined;

    const orden = await updateOrder(id, patch, { ...serviceDeps, role: user.role, correction });
    return NextResponse.json({ orden });
  } catch (err) {
    if (err instanceof CorrectionRefusedError) {
      if (err.reason === "throttled") {
        return NextResponse.json(
          { error: "throttled", message: "Demasiados intentos. Probá de nuevo en 15 minutos." },
          { status: 429, headers: { "Retry-After": RETRY_AFTER_SECONDS } },
        );
      }
      return err.reason === "wrong_password"
        ? NextResponse.json({ error: "wrong_password", message: "Contraseña incorrecta" }, { status: 403 })
        : NextResponse.json({ errors: { form: "Solo un administrador puede corregir una orden cerrada." } }, { status: 403 });
    }
    if (err instanceof OrderClosedError) {
      // A password from someone who may not correct is refused (403); otherwise
      // the closed order refuses the caller as before (409).
      const refused = typeof body.password === "string" && !can(user, "service-orders.correct");
      return refused
        ? NextResponse.json({ errors: { form: "Solo un administrador puede corregir una orden cerrada." } }, { status: 403 })
        : NextResponse.json({ errors: { form: "No se puede editar una orden completada o cancelada." } }, { status: 409 });
    }
    if (err instanceof OrderEditForbiddenError) {
      return NextResponse.json({ errors: { form: "Solo un administrador puede editar una orden abierta." } }, { status: 403 });
    }
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
