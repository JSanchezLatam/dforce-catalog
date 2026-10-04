import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import {
  markContactado,
  VehiculoNotFoundError,
  VencimientoValidationError,
  type MarkContactadoDeps,
  type MarkContactadoInput,
} from "@/modules/vencimientos/service";

/**
 * Records one "Contactado" mark. 200 on insert AND on a duplicate (idempotent),
 * 400 for a body or period key that does not fit, 404 for an unknown vehicle.
 * `can()` runs before the body is read.
 */
export async function handleContactVencimiento(request: NextRequest, deps: MarkContactadoDeps = {}): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "vencimientos.contact")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: { form: "La solicitud no es válida" } }, { status: 400 });
  }

  try {
    await markContactado((body ?? {}) as MarkContactadoInput, user.id, deps);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof VencimientoValidationError) {
      return NextResponse.json({ errors: err.errors }, { status: 400 });
    }
    if (err instanceof VehiculoNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }
}

export async function POST(request: NextRequest) {
  return handleContactVencimiento(request);
}
