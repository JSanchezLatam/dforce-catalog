import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { getObject, putObject, deleteObject } from "@/modules/catalog-storage/r2";
import {
  deleteTemplateCoverImage,
  listTemplateCoverImages,
  upsertTemplateCoverImage,
} from "@/modules/template-config/service";
import { validateLogo, MAX_UPLOAD_BYTES } from "@/modules/workshop-config/logo";
import { KNOWN_TEMPLATE_IDS } from "@/shared/template/template-ids";

/**
 * Per-template cover photo (catalog-cover-templates WU3a). Same upload idiom
 * as the retired `workshop-config/cover-image` route, keyed by the registry id
 * in the URL. `validateLogo` is reused as-is: it sniffs image bytes
 * generically. It accepts SVG, which is why GET keeps the CSP sandbox.
 *
 * Every method needs `template.edit`: the photo is template config and only
 * the template-config admin page reads it.
 */
type Context = { params: Promise<{ templateId: string }> };

/** `{ denied }` (403 or 404) to return as-is, or `{ templateId }` when the caller may proceed. */
async function guard(
  request: NextRequest,
  { params }: Context,
): Promise<{ denied: NextResponse } | { templateId: string }> {
  const user = requireSession(request);
  if (!can(user, "template.edit")) {
    return { denied: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const { templateId } = await params;
  if (!(KNOWN_TEMPLATE_IDS as readonly string[]).includes(templateId)) {
    return { denied: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { templateId };
}

export async function GET(request: NextRequest, context: Context) {
  const checked = await guard(request, context);
  if ("denied" in checked) return checked.denied;

  const image = (await listTemplateCoverImages()).find((r) => r.templateId === checked.templateId);
  if (!image) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const buffer = await getObject(image.r2Key);
  if (!buffer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": image.contentType ?? "application/octet-stream",
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=60",
      ETag: image.r2Key,
    },
  });
}

export async function POST(request: NextRequest, context: Context) {
  const checked = await guard(request, context);
  if ("denied" in checked) return checked.denied;

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  let cover;
  try {
    cover = validateLogo(Buffer.from(await file.arrayBuffer()));
  } catch {
    return NextResponse.json({ error: "Invalid image format" }, { status: 400 });
  }

  const key = `covers/${checked.templateId}/${Date.now()}.${cover.ext}`;
  await putObject(key, cover.buffer, cover.contentType);

  const previousKey = await upsertTemplateCoverImage(checked.templateId, {
    r2Key: key,
    contentType: cover.contentType,
  });
  if (previousKey) await deleteObject(previousKey).catch(() => {});

  return NextResponse.json({ key });
}

export async function DELETE(request: NextRequest, context: Context) {
  const checked = await guard(request, context);
  if ("denied" in checked) return checked.denied;

  const removedKey = await deleteTemplateCoverImage(checked.templateId);
  if (removedKey) await deleteObject(removedKey).catch(() => {});

  return NextResponse.json({ success: true });
}
