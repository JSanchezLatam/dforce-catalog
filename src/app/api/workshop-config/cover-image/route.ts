import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { getObject, putObject, deleteObject } from "@/modules/catalog-storage/r2";
import { getWorkshopConfig, saveWorkshopConfig } from "@/modules/workshop-config/service";
import { validateLogo, MAX_UPLOAD_BYTES } from "@/modules/workshop-config/logo";

/**
 * Mirrors `logo/route.ts` exactly (design D6, task 6.5) — same upload idiom,
 * same admin gating, same partial-touch discipline against the singleton row.
 * `validateLogo` is reused as-is: it validates image bytes generically (PNG/
 * JPEG/WebP/SVG magic-byte sniffing + size caps), nothing about it is
 * logo-specific.
 */
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
  if (!config?.coverImageR2Key) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await getObject(config.coverImageR2Key);
  if (!buffer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": config.coverImageContentType ?? "application/octet-stream",
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=60",
      ETag: config.coverImageR2Key,
    },
  });
}

export async function POST(request: NextRequest) {
  const denied = authorize("workshop.edit", request);
  if (denied) return denied;

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }

  const form = await request.formData();
  const file = form.get("file");

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  let cover;
  try {
    cover = validateLogo(bytes);
  } catch {
    return NextResponse.json({ error: "Invalid image format" }, { status: 400 });
  }

  const key = `covers/${Date.now()}.${cover.ext}`;
  await putObject(key, cover.buffer, cover.contentType);

  const prev = await getWorkshopConfig();
  if (prev?.coverImageR2Key) {
    await deleteObject(prev.coverImageR2Key).catch(() => {});
  }

  // Only coverImageR2Key/coverImageContentType — name is partial-touch on
  // saveWorkshopConfig (service.ts), so resending it here would clobber a
  // name saved concurrently through the main settings form while this
  // upload was in flight (the exact bug WU1's apply-progress recorded on
  // the logo route).
  await saveWorkshopConfig({ coverImageR2Key: key, coverImageContentType: cover.contentType });

  return NextResponse.json({ key });
}

export async function DELETE(request: NextRequest) {
  const denied = authorize("workshop.edit", request);
  if (denied) return denied;

  await saveWorkshopConfig({ coverImageR2Key: null, coverImageContentType: null });

  return NextResponse.json({ success: true });
}
