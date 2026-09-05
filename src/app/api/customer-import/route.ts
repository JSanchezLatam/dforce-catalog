import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { runCustomerImport as runCustomerImportJob } from "@/modules/customer-import/job";
import { InterfuerzaAbortError } from "@/shared/interfuerza/client";

/**
 * R21 — manual trigger for the Interfuerza customer import. Same
 * `requireSession()` then `can()` gate, same error-mapping shape as
 * `api/customers/route.ts`. Runs `runCustomerImport` synchronously (no
 * pg-boss queue, unlike inventory-sync) — the import is a manual, on-demand
 * action, and its result (created/updated/skipped) is exactly what the
 * caller needs back.
 */
export type HandleCustomerImportDeps = { runCustomerImport?: typeof runCustomerImportJob };

export async function handleCustomerImport(
  request: NextRequest,
  deps: HandleCustomerImportDeps = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "customers.write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await (deps.runCustomerImport ?? runCustomerImportJob)();
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof InterfuerzaAbortError) {
      // D6/R21 — the run aborted with nothing persisted; not a validation
      // error on the caller's request, so 502 (upstream failure) rather than
      // 400/500.
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleCustomerImport(request);
}
