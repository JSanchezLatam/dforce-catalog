import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { getTemplateConfig, saveTemplateConfig, TemplateConfigValidationError } from "@/modules/template-config/service";

/**
 * Admin-only template-config action (R8, R9.6/NFR-8 — "template.edit" is one
 * of the three explicit `can()`-gated actions). `proxy.ts` already guarantees
 * a valid session (401) for every request that reaches here; this route adds
 * the role check (403) before any business logic, same as design.md's
 * "Route handlers call requireSession() then can()" for admin-only actions.
 */
function requireTemplateEditAccess(request: NextRequest) {
  const user = requireSession(request);
  if (!can(user, "template.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const denied = requireTemplateEditAccess(request);
  if (denied) return denied;

  const config = await getTemplateConfig();
  return NextResponse.json({ config });
}

export async function POST(request: NextRequest) {
  const denied = requireTemplateEditAccess(request);
  if (denied) return denied;

  const body = await request.json();
  try {
    const config = await saveTemplateConfig(body);
    return NextResponse.json({ config });
  } catch (err) {
    if (err instanceof TemplateConfigValidationError) {
      return NextResponse.json({ errors: err.errors }, { status: 400 });
    }
    throw err;
  }
}
