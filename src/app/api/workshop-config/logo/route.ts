import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { getObject, putObject, deleteObject } from "@/modules/catalog-storage/r2";
import { getWorkshopConfig, saveWorkshopConfig } from "@/modules/workshop-config/service";
import { validateLogo, MAX_UPLOAD_BYTES } from "@/modules/workshop-config/logo";

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
    // Route Handlers run on the Node.js runtime by default (this file
    // declares no `export const runtime = "edge"`, and couldn't use one —
    // it needs DB and R2 access). `Buffer` is a `Uint8Array` subclass but
    // `NextResponse`'s body type wants a plain `Uint8Array`/`BodyInit`, so
    // this wrapping is just satisfying that type, not an edge-runtime
    // requirement.
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

  // Reject BEFORE buffering: on a single-process standalone Node deployment,
  // request.formData() reads the entire body into memory. The exact format
  // (and its tighter SVG cap) can only be known after sniffing magic bytes,
  // which needs the body already read — so this checks the declared
  // Content-Length against the largest of the two caps first. A client that
  // lies about (or omits) Content-Length still hits validateLogo()'s
  // per-format size check below, after the body is read; that residual gap
  // is unavoidable without a streaming multipart parser.
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

  // Only logoR2Key/logoContentType — name is partial-touch on saveWorkshopConfig
  // (service.ts), so resending it here would clobber a name saved concurrently
  // through the main settings form while this upload was in flight.
  await saveWorkshopConfig({ logoR2Key: key, logoContentType: logo.contentType });

  return NextResponse.json({ key });
}

export async function DELETE(request: NextRequest) {
  const denied = authorize("workshop.edit", request);
  if (denied) return denied;

  // Same partial-touch reasoning as POST above — name is not read here at all.
  await saveWorkshopConfig({ logoR2Key: null, logoContentType: null });

  return NextResponse.json({ success: true });
}
