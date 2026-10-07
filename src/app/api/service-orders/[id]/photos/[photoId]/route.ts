import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { getObject } from "@/modules/catalog-storage/r2";
import { deleteOrderPhoto, findOrderPhoto, PhotoNotFoundError } from "@/modules/service-orders/photos";
import { orderScope } from "@/modules/service-orders/scope";
import { OrdenServicioNotFoundError } from "@/modules/service-orders/service";
import { attemptWithCorrection, correctionErrorResponse, type Authorize } from "../../../correction-http";

type Ids = { ordenId: string; photoId: string };
type Context = { params: Promise<{ id: string; photoId: string }> };

export type GetPhotoDeps = { findPhoto?: typeof findOrderPhoto; getObject?: typeof getObject };
export type DeletePhotoDeps = { deletePhoto?: typeof deleteOrderPhoto; authorize?: Authorize };

export async function handleGetPhoto(
  request: NextRequest,
  ids: Ids,
  deps: GetPhotoDeps = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "service-orders.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Both ids, and the caller's scope: a photo of an order a técnico is not assigned to answers 404 like a missing one.
  const photo = await (deps.findPhoto ?? findOrderPhoto)(ids, orderScope(user));
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const buffer = await (deps.getObject ?? getObject)(photo.r2Key);
  if (!buffer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      // The bytes behind a photo id never change, and the print page re-requests up to 12 of them.
      "Cache-Control": "private, max-age=86400, immutable",
      // A strong validator is a quoted string (RFC 9110 8.8.3).
      ETag: `"${ids.photoId}"`,
    },
  });
}

export async function handleDeletePhoto(
  request: NextRequest,
  ids: Ids,
  deps: DeletePhotoDeps = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  // 403 before any lookup, so a técnico cannot probe which photo ids exist.
  if (!can(user, "service-orders.deletePhoto")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const canCorrect = can(user, "service-orders.correct");

  // The existing client sends no body: an unreadable one means "no password", not a 500.
  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : undefined;

  try {
    const remove = deps.deletePhoto ?? deleteOrderPhoto;
    await attemptWithCorrection(
      user,
      canCorrect,
      password,
      (correction) => remove(correction ? { ...ids, correction } : ids),
      deps.authorize,
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof PhotoNotFoundError || err instanceof OrdenServicioNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const refused = correctionErrorResponse(err, canCorrect);
    if (refused) return refused;
    throw err;
  }
}

export async function GET(request: NextRequest, { params }: Context): Promise<NextResponse> {
  const { id, photoId } = await params;
  return handleGetPhoto(request, { ordenId: id, photoId });
}

export async function DELETE(request: NextRequest, { params }: Context): Promise<NextResponse> {
  const { id, photoId } = await params;
  return handleDeletePhoto(request, { ordenId: id, photoId });
}
