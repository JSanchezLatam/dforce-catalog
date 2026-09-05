import { NextResponse, type NextRequest } from "next/server";

import type { Cliente } from "@/shared/db/schema";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import {
  ClienteDeactivatedError,
  ClienteNotFoundError,
  deactivateCliente as deactivateClienteService,
  DuplicatePhoneError,
  reactivateCliente as reactivateClienteService,
  updateCliente,
  type UpdateClienteDeps,
} from "@/modules/customers/service";
import { ClienteValidationError } from "@/modules/customers/validation";

/** R20 — the route's own seam, extending the service's with the two activation calls. */
export type ClienteRouteDeps = UpdateClienteDeps & {
  deactivateCliente?: (id: string) => Promise<Cliente>;
  reactivateCliente?: (id: string) => Promise<Cliente>;
};

/** Any element of an incoming `vehicles` array asking for permanent deletion. */
function asksForVehicleDeletion(body: unknown): boolean {
  const vehicles = (body as { vehicles?: unknown } | null)?.vehicles;
  return Array.isArray(vehicles) && vehicles.some((v) => (v as { deleted?: unknown } | null)?.deleted === true);
}

export async function handleUpdateCliente(
  request: NextRequest,
  id: string,
  deps: ClienteRouteDeps = {},
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

  // R20 — activation is routed to its own service calls, never folded into the
  // patch. `active` is not a column; forwarded to `updateCliente` it would
  // become a SET on one that does not exist. Same split as
  // `api/users/[id]/route.ts`, and the same reason `vehicles` is stripped.
  const { active, ...fields } = (body ?? {}) as { active?: unknown } & Record<string, unknown>;
  const deactivate = deps.deactivateCliente ?? deactivateClienteService;
  const reactivate = deps.reactivateCliente ?? reactivateClienteService;

  try {
    // ORDER IS LOAD-BEARING. `updateCliente` refuses to edit a deactivated
    // record (D5), so reactivation lands BEFORE the field edits — otherwise an
    // "edit and reactivate" save would be rejected by its own first step.
    // Deactivation goes last for the mirror reason: edits applied to a record
    // on its way out are still edits to an active one.
    let cliente = active === true ? await reactivate(id) : undefined;

    // `active === undefined` means this is an ordinary edit and behaves
    // exactly as it did before R20 — including an empty body.
    if (active === undefined || Object.keys(fields).length > 0) {
      cliente = await updateCliente(id, fields, deps);
    }

    if (active === false) {
      cliente = await deactivate(id);
    }

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
    if (err instanceof ClienteDeactivatedError) {
      // 409, not 403: the caller is allowed to do this, the RECORD's state is
      // what refuses. A 403 would send them looking for a missing permission.
      return NextResponse.json({ error: "cliente_deactivated" }, { status: 409 }); // R20/D5
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
