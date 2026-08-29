import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import {
  countClientes as countClientesQuery,
  listClientes as listClientesQuery,
  type ClienteListItem,
} from "@/modules/customers/queries";
import { relaxSearchTerm } from "@/modules/customers/near-match";
import { createCliente, DuplicatePhoneError, type CreateClienteDeps } from "@/modules/customers/service";
import { ClienteValidationError } from "@/modules/customers/validation";
import { computePageWindow, parsePageSize } from "@/modules/inventory-view/queries";

export type ListClientesDeps = {
  listClientes?: typeof listClientesQuery;
  countClientes?: typeof countClientesQuery;
};

export type ListClientesResponseBody = {
  customers: ClienteListItem[];
  total: number;
  /** Present only when `customers` are near matches for a relaxed term (design.md). */
  relaxedFrom?: string;
};

/**
 * R19 — search/pagination read, mirroring `handleListUsers`'s shape
 * (`api/users/route.ts:19-36`): `can()` runs before the query string or any
 * dependency is touched. When the primary search returns zero rows, a
 * second pass re-runs the same query with `relaxSearchTerm`'s broader term
 * (design.md's near-match decision) — `queries.ts` itself stays untouched.
 */
export async function handleListClientes(
  request: NextRequest,
  deps: ListClientesDeps = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "customers.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const search = params.get("search")?.trim() || undefined;
  const pageSize = parsePageSize(params.get("pageSize") ?? undefined);
  const pageWindow = computePageWindow(params.get("page") ?? undefined, pageSize);

  const list = deps.listClientes ?? listClientesQuery;
  const countFn = deps.countClientes ?? countClientesQuery;

  // Both round-trips at once, as `customers/page.tsx:49` does — the search is
  // a sequential scan, so serialising them doubles every keystroke's latency.
  let [customers, total] = await Promise.all([list({ search }, pageWindow), countFn({ search })]);
  let relaxedFrom: string | undefined;

  if (search && customers.length === 0) {
    const relaxed = relaxSearchTerm(search);
    if (relaxed) {
      [customers, total] = await Promise.all([list({ search: relaxed }, pageWindow), countFn({ search: relaxed })]);
      if (customers.length > 0) relaxedFrom = relaxed;
    }
  }

  const body: ListClientesResponseBody = { customers, total, ...(relaxedFrom ? { relaxedFrom } : {}) };
  return NextResponse.json(body);
}

export async function handleCreateCliente(
  request: NextRequest,
  deps: CreateClienteDeps = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "customers.write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  try {
    const cliente = await createCliente(body, deps);
    return NextResponse.json({ cliente }, { status: 201 });
  } catch (err) {
    if (err instanceof ClienteValidationError) {
      return NextResponse.json({ errors: err.errors }, { status: 400 }); // R17
    }
    if (err instanceof DuplicatePhoneError) {
      // R18 — client links to the existing customer's detail view.
      return NextResponse.json({ error: "duplicate_phone", existingClienteId: err.existingClienteId }, { status: 409 });
    }
    throw err;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleListClientes(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleCreateCliente(request);
}
