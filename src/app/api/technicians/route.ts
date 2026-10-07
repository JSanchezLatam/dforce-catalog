import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { createTecnico as createTecnicoService } from "@/modules/technicians/service";
import { technicianErrorResponse } from "./technicians-http";

/**
 * `technicians.manage` runs first, then `users.manage` when the body names a
 * link: only an administrador decides which login maps to which roster row.
 * Both run before any service code, and the body keys are whitelisted.
 */
export async function handleCreateTecnico(
  request: NextRequest,
  deps: { createTecnico?: typeof createTecnicoService } = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "technicians.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const input: { nombre?: string; userId?: string | null } = {};
  if (typeof body?.nombre === "string") input.nombre = body.nombre;
  if (body?.userId !== undefined) {
    if (!can(user, "users.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (body.userId !== null && typeof body.userId !== "string") {
      return NextResponse.json({ errors: { userId: "El usuario no es válido." } }, { status: 400 });
    }
    input.userId = body.userId;
  }

  try {
    const technician = await (deps.createTecnico ?? createTecnicoService)({ role: user.role }, input);
    return NextResponse.json({ technician }, { status: 201 });
  } catch (err) {
    return technicianErrorResponse(err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleCreateTecnico(request);
}
