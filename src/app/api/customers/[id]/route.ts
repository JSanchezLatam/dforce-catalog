import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import {
  ClienteNotFoundError,
  DuplicatePhoneError,
  updateCliente,
  type UpdateClienteDeps,
} from "@/modules/customers/service";
import { ClienteValidationError } from "@/modules/customers/validation";

/** Any element of an incoming `vehicles` array asking for permanent deletion. */
function asksForVehicleDeletion(body: unknown): boolean {
  const vehicles = (body as { vehicles?: unknown } | null)?.vehicles;
  return Array.isArray(vehicles) && vehicles.some((v) => (v as { deleted?: unknown } | null)?.deleted === true);
}

export async function handleUpdateCliente(
  request: NextRequest,
  id: string,
  deps: UpdateClienteDeps = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "customers.write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  // Deactivating a vehicle is reversible and stays with `customers.write`;
  // destroying the row is not, and every other irreversible capability in this
  // app is gated in `policy.ts` rather than left implicit. Read from the RAW
  // body, before validation and before the service: the grant decides whether
  // the request may be considered at all, so a malformed payload asking for a
  // deletion must be refused, not corrected and then executed.
  if (asksForVehicleDeletion(body) && !can(user, "customers.deleteVehicle")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
