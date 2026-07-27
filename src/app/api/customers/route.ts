import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { createCliente, DuplicatePhoneError, type CreateClienteDeps } from "@/modules/customers/service";
import { ClienteValidationError } from "@/modules/customers/validation";

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

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleCreateCliente(request);
}
