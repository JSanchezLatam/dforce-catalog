import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/modules/auth/roles";
import { OrderClosedError, PhotoNotFoundError } from "@/modules/service-orders/photos";
import { OrdenServicioNotFoundError } from "@/modules/service-orders/service";
import { DELETE, GET, handleDeletePhoto, handleGetPhoto } from "./route";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function req(method: "GET" | "DELETE", role: Role = "tecnico") {
  return new NextRequest("http://localhost/api/service-orders/o1/photos/p1", {
    method,
    headers: { "x-user-id": "user-1", "x-user-role": role },
  });
}

describe("GET /api/service-orders/[id]/photos/[photoId]", () => {
  const found = { r2Key: "service-orders/o1/p1.jpg" };

  it("serves the bytes as a private, immutable, sandboxed image/jpeg", async () => {
    const findPhoto = vi.fn().mockResolvedValue(found);
    const getObject = vi.fn().mockResolvedValue(JPEG);
    const res = await handleGetPhoto(req("GET"), { ordenId: "o1", photoId: "p1" }, { findPhoto, getObject });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("ETag")).toBe('"p1"');
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400, immutable");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(JPEG);
    expect(getObject).toHaveBeenCalledWith("service-orders/o1/p1.jpg");
  });

  it("looks the photo up by BOTH ids, so another order's photo id is a 404", async () => {
    const findPhoto = vi.fn().mockResolvedValue(null);
    const getObject = vi.fn();
    const res = await handleGetPhoto(req("GET"), { ordenId: "other-order", photoId: "p1" }, { findPhoto, getObject });

    expect(findPhoto).toHaveBeenCalledWith({ ordenId: "other-order", photoId: "p1" });
    expect(res.status).toBe(404);
    expect(getObject).not.toHaveBeenCalled();
  });

  it("404 when the row exists but the object is gone", async () => {
    const res = await handleGetPhoto(
      req("GET"),
      { ordenId: "o1", photoId: "p1" },
      { findPhoto: vi.fn().mockResolvedValue(found), getObject: vi.fn().mockResolvedValue(null) },
    );
    expect(res.status).toBe(404);
  });

  it("refuses a request with no session", async () => {
    const request = new NextRequest("http://localhost/api/service-orders/o1/photos/p1");
    await expect(GET(request, { params: Promise.resolve({ id: "o1", photoId: "p1" }) })).rejects.toThrow();
  });
});

describe("DELETE /api/service-orders/[id]/photos/[photoId]", () => {
  const ids = { ordenId: "o1", photoId: "p1" };

  it("403 for a tecnico and nothing is deleted", async () => {
    const deletePhoto = vi.fn();
    const res = await handleDeletePhoto(req("DELETE", "tecnico"), ids, { deletePhoto });

    expect(res.status).toBe(403);
    expect(deletePhoto).not.toHaveBeenCalled();
  });

  it("403 for a tecnico even when the photo does not exist (403 before 404)", async () => {
    const deletePhoto = vi.fn().mockRejectedValue(new PhotoNotFoundError());
    const res = await handleDeletePhoto(req("DELETE", "tecnico"), ids, { deletePhoto });

    expect(res.status).toBe(403);
  });

  it("an administrador deletes the photo", async () => {
    const deletePhoto = vi.fn().mockResolvedValue(undefined);
    const res = await handleDeletePhoto(req("DELETE", "administrador"), ids, { deletePhoto });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(deletePhoto).toHaveBeenCalledWith(ids);
  });

  it("409 order_closed on a closed order", async () => {
    const deletePhoto = vi.fn().mockRejectedValue(new OrderClosedError());
    const res = await handleDeletePhoto(req("DELETE", "administrador"), ids, { deletePhoto });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "order_closed",
      message: "La orden está cerrada",
    });
  });

  it("404 for a photo that is not in this order, and for a missing order", async () => {
    for (const err of [new PhotoNotFoundError(), new OrdenServicioNotFoundError("o1")]) {
      const res = await handleDeletePhoto(req("DELETE", "administrador"), ids, {
        deletePhoto: vi.fn().mockRejectedValue(err),
      });
      expect(res.status).toBe(404);
    }
  });

  it("refuses a request with no session", async () => {
    const request = new NextRequest("http://localhost/api/service-orders/o1/photos/p1", { method: "DELETE" });
    await expect(DELETE(request, { params: Promise.resolve({ id: "o1", photoId: "p1" }) })).rejects.toThrow();
  });
});
