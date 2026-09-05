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
  //
  // Deliberate ordering (fix 2, customer-import-fixes): this gate runs BEFORE
  // the active/fields mutual-exclusion check below, so `{ active: false,
  // vehicles: [{ deleted: true }] }` from a role without `customers.deleteVehicle`
  // gets 403, never the mutual-exclusion 400 — the permission question wins.
  // Consistent with the paragraph above: authorization decides whether the
  // request may be considered AT ALL, so it must not be shadowed by a 400 a
  // validation rule further down would otherwise raise first. If a role ever
  // gains `customers.deleteVehicle`, this ordering stops mattering for it —
  // the mutual-exclusion check still runs, just next.
  if (asksForVehicleDeletion(body) && !can(user, "customers.deleteVehicle")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // R20 — activation is routed to its own service calls, never folded into the
  // patch. `active` is not a column; forwarded to `updateCliente` it would
  // become a SET on one that does not exist. Same split as
  // `api/users/[id]/route.ts`, and the same reason `vehicles` is stripped.
  const { active, ...fields } = (body ?? {}) as { active?: unknown } & Record<string, unknown>;
  // The three branches below are `true`, `undefined` and `false`. Anything else
  // fell through all of them and answered 200 having written nothing — the
  // button sees `response.ok`, refreshes, and the operator watches the state
  // not change with no message anywhere. That is the same silence the network
  // -failure `catch` was just added to eliminate, one layer up.
  //
  // Rejected rather than coerced, matching `confirmsSharedPhone`'s strict
  // `=== true` in `service.ts`: a truthy `"false"` from a form encoding or a
  // query string must not be read as an intent.
  if (active !== undefined && typeof active !== "boolean") {
    return NextResponse.json({ errors: { active: "Debe ser un booleano" } }, { status: 400 });
  }

  // Activation and field edits are mutually exclusive, and this is the whole
  // fix for a non-atomic PATCH rather than a transaction around it.
  //
  // Ordering them was the previous attempt: reactivate, then edit, then
  // deactivate. That argument only holds when everything succeeds.
  // `{ active: true, name: "" }` reactivated the customer and THEN answered
  // 400 for the invalid name — the operator saw a rejection while the record
  // went live. The mirror case wrote nothing, because deactivation ran last.
  // Same request shape, opposite outcome on failure.
  //
  // Rejecting the combination removes the hazard AND the ordering it existed
  // to serve: no UI sends both (D5 hides "Editar" while deactivated, and the
  // activation button sends `active` alone), so nothing is lost.
  if (active !== undefined && Object.keys(fields).length > 0) {
    return NextResponse.json(
      { errors: { active: "No se puede cambiar el estado y editar datos en la misma operación" } },
      { status: 400 },
    );
  }

  const deactivate = deps.deactivateCliente ?? deactivateClienteService;
  const reactivate = deps.reactivateCliente ?? reactivateClienteService;

  try {
    // Exactly one of these runs, so there is no partial state to unwind.
    // `active === undefined` is an ordinary edit and behaves exactly as it did
    // before R20, including for an empty body.
    const cliente =
      active === true
        ? await reactivate(id)
        : active === false
          ? await deactivate(id)
          : await updateCliente(id, fields, deps);

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
