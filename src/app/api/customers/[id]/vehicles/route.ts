import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { listVehiculosByCliente as listVehiculosByClienteQuery } from "@/modules/customers/vehicles";

export type ListVehiculosByClienteDeps = {
  listVehiculosByCliente?: typeof listVehiculosByClienteQuery;
};

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
