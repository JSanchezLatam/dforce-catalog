import { NextResponse, type NextRequest } from "next/server";

import { requireSession } from "@/modules/auth/session";
import {
  ClienteNotFoundError,
  DuplicatePhoneError,
  updateCliente,
  type UpdateClienteDeps,
} from "@/modules/customers/service";
import { ClienteValidationError } from "@/modules/customers/validation";

/**
 * R16 — edit a `cliente` (also the R26 opt-out toggle path: `whatsappOptOut`
 * / `emailOptOut` are just two more patchable fields, checked independently
 * per channel at reminder fire time — see reminders/job.ts's `runReminder`).
 * `handleUpdateCliente` takes the already-resolved `id` so `route.test.ts`
 * doesn't need to await Next's `params` Promise to call it directly (mirrors
 * `manual/route.ts`'s `handleX` DI split).
 */
export async function handleUpdateCliente(
  request: NextRequest,
  id: string,
  deps: UpdateClienteDeps = {},
): Promise<NextResponse> {
  requireSession(request);

  const body = await request.json();
  try {
    const cliente = await updateCliente(id, body, deps);
    return NextResponse.json({ cliente });
  } catch (err) {
    if (err instanceof ClienteValidationError) {
      return NextResponse.json({ errors: err.errors }, { status: 400 }); // R17
    }
    if (err instanceof DuplicatePhoneError) {
      return NextResponse.json({ error: "duplicate_phone", existingClienteId: err.existingClienteId }, { status: 409 }); // R18
    }
    if (err instanceof ClienteNotFoundError) {
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
  return handleUpdateCliente(request, id);
}
