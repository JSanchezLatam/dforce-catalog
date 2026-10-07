import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { OrderClosedError, OrderEditForbiddenError } from "@/modules/service-orders/order-lock";
import {
  markParteLista,
  ParteListaForbiddenError,
  ParteListaRefusedError,
  unmarkParteLista,
} from "@/modules/service-orders/parte-lista";
import { orderScope } from "@/modules/service-orders/scope";
import { OrdenServicioNotFoundError } from "@/modules/service-orders/service";

export type MarkDeps = { mark?: typeof markParteLista };
export type UnmarkDeps = { unmark?: typeof unmarkParteLista };

/** The same refusals for mark and un-mark; `null` for anything it does not know. */
function refusal(err: unknown): NextResponse | null {
  if (err instanceof OrdenServicioNotFoundError) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (err instanceof ParteListaForbiddenError) {
    return NextResponse.json({ error: "forbidden", message: err.message }, { status: 403 });
  }
  if (err instanceof ParteListaRefusedError) {
    return NextResponse.json({ error: "parte_lista", message: err.message }, { status: 409 });
  }
  // Never correctable: no `attemptWithCorrection`, so a password in the body is never read.
  if (err instanceof OrderClosedError) {
    return NextResponse.json({ error: "order_closed", message: "La orden está cerrada y su parte ya no se puede cambiar." }, { status: 409 });
  }
  if (err instanceof OrderEditForbiddenError) {
    return NextResponse.json(
      { error: "order_status", message: "La orden no admite cambios en tu parte en este estado." },
      { status: 409 },
    );
  }
  return null;
}

/** The body is optional: only a `tecnicoId` in it matters, and only so the service can refuse another technician's. */
async function namedTecnico(request: NextRequest): Promise<string | undefined> {
  const body = await request.json().catch(() => null);
  return typeof body?.tecnicoId === "string" ? body.tecnicoId : undefined;
}

export async function handleMark(request: NextRequest, ordenId: string, deps: MarkDeps = {}): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "service-orders.write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const result = await (deps.mark ?? markParteLista)({
      ordenId,
      userId: user.id,
      tecnicoId: await namedTecnico(request),
      scope: orderScope(user),
    });
    return NextResponse.json(result);
  } catch (err) {
    const refused = refusal(err);
    if (refused) return refused;
    throw err;
  }
}

export async function handleUnmark(request: NextRequest, ordenId: string, deps: UnmarkDeps = {}): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "service-orders.write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const result = await (deps.unmark ?? unmarkParteLista)({
      ordenId,
      userId: user.id,
      tecnicoId: await namedTecnico(request),
      scope: orderScope(user),
    });
    return NextResponse.json(result);
  } catch (err) {
    const refused = refusal(err);
    if (refused) return refused;
    throw err;
  }
}

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Context): Promise<NextResponse> {
  const { id } = await params;
  return handleMark(request, id);
}

export async function DELETE(request: NextRequest, { params }: Context): Promise<NextResponse> {
  const { id } = await params;
  return handleUnmark(request, id);
}
