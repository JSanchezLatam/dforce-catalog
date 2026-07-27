import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { getWorkshopConfig, saveWorkshopConfig, WorkshopConfigValidationError } from "@/modules/workshop-config/service";

function authorize(action: "workshop.read" | "workshop.edit", request: NextRequest) {
  const user = requireSession(request);
  if (!can(user, action)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const denied = authorize("workshop.read", request);
  if (denied) return denied;

  const config = await getWorkshopConfig();
  return NextResponse.json({ config });
}

export async function POST(request: NextRequest) {
  const denied = authorize("workshop.edit", request);
  if (denied) return denied;

  const body = await request.json();
  try {
    const config = await saveWorkshopConfig(body);
    return NextResponse.json({ config });
  } catch (err) {
    if (err instanceof WorkshopConfigValidationError) {
      return NextResponse.json({ errors: err.errors }, { status: 400 });
    }
    throw err;
  }
}
