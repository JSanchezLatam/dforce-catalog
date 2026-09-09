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

/**
 * The two nullable `text` columns this route writes, guarded exactly as
 * `[id]/route.ts` guards the same columns on the patch side. They were
 * forwarded raw until WU4's review: `pg` stringifies an object, so
 * `observaciones: { evil: 1 }` was a 400 one route over and a 201 here,
 * landing `{"evil":1}` in an unbounded column — and a 6000-character string
 * saved outright. `hallazgos`/`recomendaciones` are absent on purpose:
 * `createOrder`'s own `.values({...})` whitelist never reads them.
 */
const NULLABLE_TEXT_FIELDS = ["description", "observaciones"] as const;

/** Same bound as the patch route: generous for a technician's notes, finite. */
const MAX_TEXT_LENGTH = 5000;

export async function handleCreateOrdenServicio(
  request: NextRequest,
  deps: CreateOrdenServicioDeps = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "service-orders.write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  for (const field of NULLABLE_TEXT_FIELDS) {
    if (body[field] === undefined || body[field] === null) continue;
    if (typeof body[field] !== "string") {
      return NextResponse.json({ errors: { [field]: "Valor inválido" } }, { status: 400 });
    }
    if (body[field].length > MAX_TEXT_LENGTH) {
      return NextResponse.json({ errors: { [field]: "Texto demasiado largo" } }, { status: 400 });
    }
  }

  // `appointmentAt` arrives as a STRING or not at all — JSON has no Date, and
  // the form's `datetime-local` holds `""` until someone picks a moment. But
  // `CreateOrdenServicioInput` declares `Date | null`, so passing the body
  // straight through hands Drizzle a string and it dies on
  // `value.toISOString is not a function`. Measured against a real database:
  // absent and `null` save, `""` and `"2026-09-10T09:00"` both throw — which
  // is EVERY save this form can produce, and why the orders table was empty.
  //
  // The PATCH route at `[id]/route.ts` already converts here; create simply
  // never did. Same shape, same reason `new Date(garbage)` must be checked:
  // it yields an Invalid Date rather than throwing.
  let appointmentAt: Date | null = null;
  if (body.appointmentAt !== undefined && body.appointmentAt !== null && body.appointmentAt !== "") {
    const parsed = new Date(body.appointmentAt);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ errors: { appointmentAt: "Fecha inválida" } }, { status: 400 });
    }
    appointmentAt = parsed;
  }

  try {
    // Named fields, not `...body`. Two reasons, both already paid for here:
    // `createdBy` comes from the SESSION and the body's claim about identity
    // must not be able to win (follow-up 1.18); and D7 takes `items` off the
    // create path, so the route stops handing it on at all. `createOrder`'s
    // own `.values({...})` whitelist still stands behind this — a body's
    // `hallazgos`/`recomendaciones` reach neither.
    const orden = await createOrder(
      {
        clienteId: body.clienteId,
        vehiculoId: body.vehiculoId,
        categoria: body.categoria,
        description: body.description,
        observaciones: body.observaciones,
        appointmentAt,
        createdBy: user.id,
      },
      deps,
    );
    return NextResponse.json({ orden }, { status: 201 });
  } catch (err) {
    if (err instanceof ClienteDeactivatedError) {
      // 409, matching `api/customers/[id]` — the caller is permitted, the
      // RECORD's state is what refuses. A 400 would read as a malformed body.
      return NextResponse.json({ error: "cliente_deactivated" }, { status: 409 }); // customer-management R20/D5 — NOT service-orders R20, three lines below
    }
    if (err instanceof UnknownClienteError) {
      return NextResponse.json({ error: "unknown_cliente", clienteId: err.clienteId }, { status: 400 }); // service-orders R20
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
