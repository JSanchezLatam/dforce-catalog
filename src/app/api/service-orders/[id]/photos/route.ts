import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import {
  addOrderPhoto,
  isJpeg,
  MAX_PHOTO_BYTES,
  OrderClosedError,
  PhotoLimitError,
} from "@/modules/service-orders/photos";
import { OrdenServicioNotFoundError } from "@/modules/service-orders/service";

/** Multipart framing around the file itself; the real byte count is re-checked after the read. */
const MULTIPART_SLACK_BYTES = 64 * 1024;

export type AddPhotoDeps = { addPhoto?: typeof addOrderPhoto };

export async function handleAddPhoto(
  request: NextRequest,
  ordenId: string,
  deps: AddPhotoDeps = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "service-orders.write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tooLarge = () => NextResponse.json({ error: "La foto es demasiado grande" }, { status: 413 });
  // Refuse before buffering the body. A request with no usable length (chunked) could stream
  // without bound into formData(), and browsers always send one for a FormData body.
  const declared = Number(request.headers.get("content-length"));
  if (!request.headers.get("content-length") || !Number.isFinite(declared)) {
    return NextResponse.json({ error: "Falta la longitud de la foto" }, { status: 411 });
  }
  // Content-Length is a claim, so the byte count is checked again below.
  if (declared > MAX_PHOTO_BYTES + MULTIPART_SLACK_BYTES) return tooLarge();

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return NextResponse.json({ error: "No se pudo leer la foto" }, { status: 400 });
  }
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Falta la foto" }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_PHOTO_BYTES) return tooLarge();
  // The declared type is never consulted: only the magic bytes decide.
  if (!isJpeg(bytes)) {
    return NextResponse.json({ error: "La foto tiene que ser JPEG" }, { status: 400 });
  }

  try {
    const { id, position } = await (deps.addPhoto ?? addOrderPhoto)({ ordenId, bytes, createdBy: user.id });
    return NextResponse.json({ id, position }, { status: 201 });
  } catch (err) {
    if (err instanceof OrdenServicioNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (err instanceof PhotoLimitError) {
      return NextResponse.json({ error: "photo_limit", message: err.message }, { status: 409 });
    }
    if (err instanceof OrderClosedError) {
      return NextResponse.json({ error: "order_closed", message: err.message }, { status: 409 });
    }
    throw err;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handleAddPhoto(request, id);
}
