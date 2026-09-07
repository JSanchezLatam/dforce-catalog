import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { ImportAlreadyRunningError, runCustomerImport as runCustomerImportJob } from "@/modules/customer-import/job";
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
    if (err instanceof ImportAlreadyRunningError) {
      // job.ts's layer-1 guard (best-effort, checked BEFORE the fetch) —
      // 409 same as inventory-sync's SyncAlreadyRunningError mapping, but a
      // real Spanish message: staff read this, not a raw diagnostic.
      return NextResponse.json(
        { error: "Ya hay una importación de clientes en curso. Esperá a que termine antes de iniciar otra." },
        { status: 409 },
      );
    }
    if (err instanceof InterfuerzaAbortError) {
      // D6/R21 — the run aborted with nothing persisted; not a validation
      // error on the caller's request, so 502 (upstream failure) rather than
      // 400/500. `err.message` is an English diagnostic built in
      // shared/interfuerza/client.ts — logged for whoever debugs this, never
      // rendered: AGENTS.md requires Spanish for anything staff read.
      console.error("[customer-import] aborted:", err.message);
      return NextResponse.json(
        { error: "No se pudo completar la importación. No se guardó ningún cambio; probá de nuevo más tarde." },
        { status: 502 },
      );
    }
    throw err;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleCustomerImport(request);
}
