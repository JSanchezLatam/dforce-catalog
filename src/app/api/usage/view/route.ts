import { NextResponse, type NextRequest } from "next/server";

import { requireSession } from "@/modules/auth/session";
import { roleGroupOf } from "@/modules/usage/groups";
import { isUsageScreen, recordView, type RecordViewDeps } from "@/modules/usage/service";

export type RecordViewRouteDeps = { recordDeps?: RecordViewDeps };

/** Counts one view. The group comes from the SESSION, never the body; extra body keys are ignored. */
export async function handleRecordView(request: NextRequest, deps: RecordViewRouteDeps = {}): Promise<NextResponse> {
  let user;
  try {
    user = requireSession(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const group = roleGroupOf(user.role);
  if (group === null) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "validation_error", errors: { form: "No se pudo leer el pedido." } }, { status: 400 });
  }
  if (!isUsageScreen(body.screen)) {
    return NextResponse.json({ error: "validation_error", errors: { screen: "Pantalla inválida." } }, { status: 400 });
  }

  await recordView(body.screen, group, deps.recordDeps);
  return new NextResponse(null, { status: 204 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleRecordView(request);
}
