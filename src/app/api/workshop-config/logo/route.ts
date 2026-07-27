import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { getObject, putObject, deleteObject } from "@/modules/catalog-storage/r2";
import { getWorkshopConfig, saveWorkshopConfig } from "@/modules/workshop-config/service";
import { validateLogo } from "@/modules/workshop-config/logo";

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
  if (!config?.logoR2Key) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await getObject(config.logoR2Key);
  if (!buffer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    // ponytail: Buffer → Uint8Array for Next.js edge runtime compat
    status: 200,
    headers: {
      "Content-Type": config.logoContentType ?? "application/octet-stream",
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=60",
      ETag: config.logoR2Key,
    },
  });
}

export async function POST(request: NextRequest) {
  const denied = authorize("workshop.edit", request);
  if (denied) return denied;

  const form = await request.formData();
  const file = form.get("file");

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  let logo;
  try {
    logo = validateLogo(bytes);
  } catch {
    return NextResponse.json({ error: "Invalid image format" }, { status: 400 });
  }

  const key = `logos/${Date.now()}.${logo.ext}`;
  await putObject(key, logo.buffer, logo.contentType);

  const prev = await getWorkshopConfig();
  if (prev?.logoR2Key) {
    await deleteObject(prev.logoR2Key).catch(() => {});
  }

  await saveWorkshopConfig({ id: "singleton", name: prev?.name ?? null, logoR2Key: key, logoContentType: logo.contentType, updatedAt: new Date() });

  return NextResponse.json({ key });
}

export async function DELETE(request: NextRequest) {
  const denied = authorize("workshop.edit", request);
  if (denied) return denied;

  const config = await getWorkshopConfig();
  await saveWorkshopConfig({ name: config?.name ?? null, logoR2Key: null, logoContentType: null });

  return NextResponse.json({ success: true });
}
