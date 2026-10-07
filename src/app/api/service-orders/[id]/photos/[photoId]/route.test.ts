import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/modules/auth/roles";
import { CorrectionRefusedError } from "@/modules/service-orders/correction-auth";
import { OrderClosedError, PhotoNotFoundError } from "@/modules/service-orders/photos";
import { OrdenServicioNotFoundError } from "@/modules/service-orders/service";
import { DELETE, GET, handleDeletePhoto, handleGetPhoto } from "./route";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function req(method: "GET" | "DELETE", role: Role = "tecnico", body?: unknown) {
  return new NextRequest("http://localhost/api/service-orders/o1/photos/p1", {
    method,
    headers: { "x-user-id": "user-1", "x-user-role": role },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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

    expect(findPhoto).toHaveBeenCalledWith({ ordenId: "other-order", photoId: "p1" }, expect.anything());
    expect(res.status).toBe(404);
    expect(getObject).not.toHaveBeenCalled();
  });

  it("looks the photo up through the caller's order scope: a técnico is scoped, an administrador is not", async () => {
    const findPhoto = vi.fn().mockResolvedValue(null);
    const ids = { ordenId: "o1", photoId: "p1" };

    const asTecnico = await handleGetPhoto(req("GET", "tecnico"), ids, { findPhoto, getObject: vi.fn() });
    expect(asTecnico.status).toBe(404);
    expect(findPhoto.mock.calls[0][1].where).toBeDefined();

    await handleGetPhoto(req("GET", "administrador"), ids, { findPhoto, getObject: vi.fn() });
    expect(findPhoto.mock.calls[1][1].where).toBeUndefined();
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

  it("403 for a jefe_taller and nothing is deleted: photo deletion stays administrador-only", async () => {
    const deletePhoto = vi.fn();
    const res = await handleDeletePhoto(req("DELETE", "jefe_taller"), ids, { deletePhoto });

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

  it("409 order_closed on a closed order for an administrador with no password", async () => {
    const deletePhoto = vi.fn().mockRejectedValue(new OrderClosedError());
    const authorize = vi.fn();
    const res = await handleDeletePhoto(req("DELETE", "administrador"), ids, { deletePhoto, authorize });
    expect(authorize).not.toHaveBeenCalled();

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "order_closed",
      message: "La orden está cerrada",
    });
  });

  describe("a closed order (closed-order-lock)", () => {
    const closed = () => vi.fn().mockRejectedValue(new OrderClosedError());

    it.each([undefined, { password: "pw" }])("403 for a tecnico with body %j, and the password is never verified", async (body) => {
      const deletePhoto = closed();
      const authorize = vi.fn();
      const res = await handleDeletePhoto(req("DELETE", "tecnico", body), ids, { deletePhoto, authorize });

      expect(res.status).toBe(403);
      expect(authorize).not.toHaveBeenCalled();
      expect(deletePhoto).not.toHaveBeenCalled();
    });

    it("403 wrong_password, and nothing is retried", async () => {
      const deletePhoto = closed();
      const authorize = vi.fn().mockRejectedValue(new CorrectionRefusedError("wrong_password"));
      const res = await handleDeletePhoto(req("DELETE", "administrador", { password: "bad" }), ids, { deletePhoto, authorize });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "wrong_password", message: "Contraseña incorrecta" });
      expect(deletePhoto).toHaveBeenCalledTimes(1);
    });

    it("429 with Retry-After 900 when throttled", async () => {
      const authorize = vi.fn().mockRejectedValue(new CorrectionRefusedError("throttled"));
      const res = await handleDeletePhoto(req("DELETE", "administrador", { password: "pw" }), ids, {
        deletePhoto: closed(),
        authorize,
      });

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("900");
      expect(await res.json()).toEqual({ error: "throttled", message: "Demasiados intentos. Probá de nuevo en 15 minutos." });
    });

    it("verifies the password, then retries WITH the grant and answers 200", async () => {
      const deletePhoto = vi.fn().mockRejectedValueOnce(new OrderClosedError()).mockResolvedValueOnce(undefined);
      const authorize = vi.fn().mockResolvedValue({ correctorId: "user-1" });
      const res = await handleDeletePhoto(req("DELETE", "administrador", { password: "pw" }), ids, { deletePhoto, authorize });

      expect(res.status).toBe(200);
      expect(authorize).toHaveBeenCalledWith("user-1", "pw");
      expect(deletePhoto).toHaveBeenNthCalledWith(1, ids);
      expect(deletePhoto).toHaveBeenNthCalledWith(2, { ...ids, correction: { correctorId: "user-1" } });
    });

    it("never verifies a password sent for an OPEN order", async () => {
      const authorize = vi.fn();
      const res = await handleDeletePhoto(req("DELETE", "administrador", { password: "pw" }), ids, {
        deletePhoto: vi.fn().mockResolvedValue(undefined),
        authorize,
      });

      expect(res.status).toBe(200);
      expect(authorize).not.toHaveBeenCalled();
    });

    it("an unreadable body is treated as no password, not a 500", async () => {
      const request = new NextRequest("http://localhost/api/service-orders/o1/photos/p1", {
        method: "DELETE",
        headers: { "x-user-id": "user-1", "x-user-role": "administrador" },
        body: "not json",
      });
      const res = await handleDeletePhoto(request, ids, { deletePhoto: closed(), authorize: vi.fn() });

      expect(res.status).toBe(409);
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
