import { NextResponse } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { getCatalogById } from "@/modules/catalog-storage/queries";
import { getObject } from "@/modules/catalog-storage/r2";

/**
 * R7.3/7.4 — one route serves both in-browser preview (default,
 * `Content-Disposition: inline`) and download (`?download=1`, `attachment`),
 * so there's exactly one place that checks ownership + upload_status + R2
 * existence.
 *
 * ponytail: on a missing/unavailable file this returns a plain JSON error
 * body (no styled "file missing, regenerate?" page) — `<a>` navigation to a
 * JSON response is minimal-but-correct for R7.5's "inform the user"; the
 * natural upgrade (a dedicated `/catalogs/[id]` info page, or a client
 * component that fetches first) is left for a requirement that asks for
 * nicer in-app messaging.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = requireSession(request);
  const { id } = await params;
  const catalog = await getCatalogById(id);

  const isOwner = catalog?.userId === user.id;
  if (!catalog || (!isOwner && !can(user, "catalogs.listAll"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // ROUTE_GUARDS registers this route as requiring "catalogs.download" —
  // that action must actually be evaluated somewhere, on top of the
  // ownership/listAll override above (which only decides WHOSE catalogs are
  // visible, not whether downloading them is permitted at all).
  if (!can(user, "catalogs.download")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (catalog.uploadStatus !== "uploaded" || !catalog.r2Key) {
    // "pending"/"uploading" (still in flight) or "failed" (retries exhausted, R11.5).
    return NextResponse.json({ error: "not_available", uploadStatus: catalog.uploadStatus }, { status: 409 });
  }

  const buffer = await getObject(catalog.r2Key);
  if (!buffer) {
    // R7.5 — row says "uploaded" but the object is gone from R2 (e.g. manual
    // bucket cleanup outside retention) — offer to regenerate, not a 500.
    return NextResponse.json({ error: "file_missing" }, { status: 404 });
  }

  const isDownload = new URL(request.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="${catalog.title}.pdf"`,
    },
  });
}
