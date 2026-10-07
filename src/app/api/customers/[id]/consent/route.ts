import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { recordConsent as recordConsentService, type ConsentState } from "@/modules/customers/consent";
import { ClienteDeactivatedError, ClienteNotFoundError } from "@/modules/customers/service";

export type ConsentRouteDeps = {
  recordConsent?: (
    clienteId: string,
    granted: boolean,
    userId: string,
  ) => Promise<{ changed: boolean; consent: ConsentState | null }>;
};

/**
 * Ley 81 consent for the customer portal: `{ granted: boolean }`, nothing
 * else. Administrador and jefe de taller only; the gate runs before the body
 * is read and before any database work.
 */
export async function handleRecordConsent(
  request: NextRequest,
  id: string,
  deps: ConsentRouteDeps = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "customers.consent")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const granted = (body as { granted?: unknown } | null)?.granted;
  // Strictly boolean, like `active` on the customer PATCH: a truthy "false"
  // from a form encoding must not be read as an intent, least of all a legal one.
  if (typeof granted !== "boolean") {
    return NextResponse.json({ errors: { granted: "Debe ser verdadero o falso" } }, { status: 400 });
  }

  try {
    const result = await (deps.recordConsent ?? recordConsentService)(id, granted, user.id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ClienteNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (err instanceof ClienteDeactivatedError) {
      // 409, not 403: the caller may do this, the record's state refuses it (R20).
      return NextResponse.json({ error: "cliente_deactivated" }, { status: 409 });
    }
    throw err;
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  return handleRecordConsent(request, id);
}
