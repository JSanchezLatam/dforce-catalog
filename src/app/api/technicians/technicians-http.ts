import { NextResponse } from "next/server";

import {
  TechnicianForbiddenError,
  TechnicianLinkError,
  TechnicianNotFoundError,
  TechnicianValidationError,
} from "@/modules/technicians/service";

/** Shared by POST and PATCH: the service's refusals as HTTP. Anything else is a real 500. */
export function technicianErrorResponse(err: unknown): NextResponse {
  if (err instanceof TechnicianValidationError) return NextResponse.json({ errors: err.errors }, { status: 400 });
  if (err instanceof TechnicianForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (err instanceof TechnicianLinkError) return NextResponse.json({ error: err.message }, { status: 409 });
  if (err instanceof TechnicianNotFoundError) return NextResponse.json({ error: "not_found" }, { status: 404 });
  throw err;
}
