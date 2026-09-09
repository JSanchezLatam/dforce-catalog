import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { getClienteById as getClienteByIdQuery } from "@/modules/customers/queries";
import { ClienteValidationError, validateVehiculoInput } from "@/modules/customers/validation";
import {
  createVehiculo as createVehiculoService,
  listVehiculosByCliente as listVehiculosByClienteQuery,
} from "@/modules/customers/vehicles";

export type ListVehiculosByClienteDeps = {
  listVehiculosByCliente?: typeof listVehiculosByClienteQuery;
};

export type CreateVehiculoRouteDeps = {
  getClienteById?: typeof getClienteByIdQuery;
  createVehiculo?: typeof createVehiculoService;
};

/**
 * D1's trust boundary. `validateVehiculoInput` is REUSED rather than copied,
 * but its return type is collection-shaped: it accepts `id`, `deleted` and
 * `deactivated`, and it permits `plate: ""` when `deleted === true` — the
 * plate-less row migration 0013's pre-flight guard aborts on. A single-insert
 * endpoint has no meaning for any of the three, so they are REFUSED rather
 * than dropped, matching `api/customers/[id]/route.ts`'s refusal of a
 * non-boolean `active`: this repo answers a body it does not understand
 * instead of quietly writing something else.
 */
const COLLECTION_ONLY_FIELDS = ["id", "deleted", "deactivated"] as const;

/**
 * C4/design.md D2 — the gap explore.md and the proposal missed: the vehicle
 * picker needs vehicle ids, which `ClienteListItem.plates` (plate strings
 * only) cannot supply, and `/api/customers/[id]` is PATCH-only. Active-only
 * (the default `listVehiculosByCliente` applies with no `includeInactive`
 * option) — the picker offers only vehicles a new order may reference.
 */
export async function handleListVehiculosByCliente(
  request: NextRequest,
  id: string,
  deps: ListVehiculosByClienteDeps = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "customers.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const list = deps.listVehiculosByCliente ?? listVehiculosByClienteQuery;
  const vehicles = await list(id);
  return NextResponse.json({ vehicles });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handleListVehiculosByCliente(request, id);
}

/**
 * D1/D3 — adds exactly ONE vehicle to an existing, active customer. Delegates
 * to `createVehiculo` (`customers/vehicles.ts`, the sole owner of the
 * `vehiculo` table), which is a plain insert and never reaches
 * `planVehiculoReconcile`: that one reads its payload as the customer's WHOLE
 * collection and would deactivate every other active vehicle this customer
 * owns. See design.md D1/D2 and `vehicles.test.ts`'s "issues exactly one
 * insert and zero updates".
 *
 * The body carries NO `cliente` field of any kind — not a name, and above all
 * not `whatsappOptOut`/`emailOptOut`, which are legally distinct consent
 * regimes (AGENTS.md). Only `plate`, `make`, `model` and `year` are read, so
 * the shape of this handler is what makes the consent trap unreachable rather
 * than merely unused.
 */
export async function handleCreateVehiculo(
  request: NextRequest,
  clienteId: string,
  deps: CreateVehiculoRouteDeps = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "customers.write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  for (const field of COLLECTION_ONLY_FIELDS) {
    if (body?.[field] !== undefined) {
      return NextResponse.json({ errors: { [field]: "No se permite en esta operación" } }, { status: 400 });
    }
  }

  // D10 — `validateVehiculoInput` keeps `year` only when it is ALREADY a
  // number (`typeof value.year === "number"`), so a JSON body sending "2019"
  // loses the year silently and the route answers 201 for a row that did not
  // save what it was sent. That is the defect class `POST /api/service-orders`
  // shipped one field over — a declared type the JSON boundary cannot satisfy
  // — and it is refused here rather than dropped. `null` is "no year", which
  // the column allows; anything else is an answer, not a write.
  if (body?.year !== undefined && body.year !== null && typeof body.year !== "number") {
    return NextResponse.json({ errors: { year: "Año inválido" } }, { status: 400 });
  }

  let input;
  try {
    // Narrowed BEFORE validation, not after: the validator's job is the
    // plate-required rule (reused, never re-implemented), and the four keys
    // below are the only ones that may reach it.
    input = validateVehiculoInput({
      plate: body?.plate,
      make: body?.make,
      model: body?.model,
      year: body?.year ?? undefined,
    });
  } catch (err) {
    if (err instanceof ClienteValidationError) {
      return NextResponse.json({ errors: err.errors }, { status: 400 }); // R17, via the shared per-vehicle rule
    }
    throw err;
  }

  // D3 — one lookup answers both record-state questions, and turns what would
  // otherwise be an FK violation into an answer instead of a 500.
  const findCliente = deps.getClienteById ?? getClienteByIdQuery;
  const detail = await findCliente(clienteId);
  if (!detail) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (detail.cliente.deactivatedAt) {
    // 409, matching `POST /api/service-orders` and `api/customers/[id]`: the
    // caller is permitted, the record's state is what refuses. A 403 would
    // send them hunting a missing permission.
    return NextResponse.json({ error: "cliente_deactivated" }, { status: 409 });
  }

  const create = deps.createVehiculo ?? createVehiculoService;
  // Named fields, never `...input`: `validateVehiculoInput`'s return type
  // still declares the three collection-only keys, and this is the last place
  // they could slip through.
  const vehiculo = await create(clienteId, {
    plate: input.plate,
    ...(input.make !== undefined ? { make: input.make } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.year !== undefined ? { year: input.year } : {}),
  });
  return NextResponse.json({ vehiculo }, { status: 201 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handleCreateVehiculo(request, id);
}
