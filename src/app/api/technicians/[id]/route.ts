import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { updateTecnico as updateTecnicoService } from "@/modules/technicians/service";
import { technicianErrorResponse } from "../technicians-http";

/** One PATCH for rename, link/unlink (administrador only) and deactivate/reactivate. */
export async function handleUpdateTecnico(
  request: NextRequest,
  id: string,
  deps: { updateTecnico?: typeof updateTecnicoService } = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "technicians.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const input: { nombre?: string; userId?: string | null; active?: boolean } = {};
  if (typeof body?.nombre === "string") input.nombre = body.nombre;
  if (body?.userId !== undefined) {
    // `null` unlinks, so it needs the same permission as a link.
    if (!can(user, "users.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (body.userId !== null && typeof body.userId !== "string") {
      return NextResponse.json({ errors: { userId: "El usuario no es válido." } }, { status: 400 });
    }
    input.userId = body.userId;
  }
  if (body?.active !== undefined) {
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ errors: { active: "El estado no es válido." } }, { status: 400 });
    }
    input.active = body.active;
  }

  try {
    const technician = await (deps.updateTecnico ?? updateTecnicoService)({ role: user.role }, id, input);
    return NextResponse.json({ technician });
  } catch (err) {
    return technicianErrorResponse(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handleUpdateTecnico(request, id);
}
