import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { PortalConsentRequiredError, rotatePortalToken } from "@/modules/customers/consent";
import { ClienteDeactivatedError, ClienteNotFoundError } from "@/modules/customers/service";

export type RotateRouteDeps = { rotate?: (clienteId: string) => Promise<void> };

/**
 * "Generar nuevo código": replaces the customer's portal token, which kills
 * every QR already printed. Administrador only, and the gate runs before the
 * body is read. The body must be exactly `{ confirm: true }`: the dialog that
 * warns about the printed QRs is the only caller, and a stray POST must not
 * rotate. The response never carries the token — the only place it is rendered
 * is the QR on the customer copy.
 */
export async function handleRotatePortalToken(
  request: NextRequest,
  id: string,
  deps: RotateRouteDeps = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "customers.portalRotate")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if ((body as { confirm?: unknown } | null)?.confirm !== true) {
    return NextResponse.json({ errors: { confirm: "Hay que confirmar el cambio de código" } }, { status: 400 });
  }

  try {
    await (deps.rotate ?? rotatePortalToken)(id);
    return NextResponse.json({ rotated: true });
  } catch (err) {
    if (err instanceof ClienteNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    // 409, not 403: the caller may do this, the record's state refuses it.
    if (err instanceof ClienteDeactivatedError) {
      return NextResponse.json({ error: "cliente_deactivated" }, { status: 409 });
    }
    if (err instanceof PortalConsentRequiredError) {
      return NextResponse.json({ error: "consent_required" }, { status: 409 });
    }
    throw err;
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  return handleRotatePortalToken(request, id);
}
