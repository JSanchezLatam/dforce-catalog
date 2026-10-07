import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/modules/auth/roles";
import { CorrectionRefusedError } from "@/modules/service-orders/correction-auth";
import { MAX_PHOTO_BYTES, OrderClosedError, PhotoLimitError } from "@/modules/service-orders/photos";
import { OrdenServicioNotFoundError } from "@/modules/service-orders/service";
import { handleAddPhoto, POST } from "./route";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function req(
  body: BodyInit | undefined,
  {
    role = "tecnico",
    contentLength = "1000",
    contentType,
  }: { role?: Role; contentLength?: string | null; contentType?: string } = {},
) {
  return new NextRequest("http://localhost/api/service-orders/o1/photos", {
    method: "POST",
    body,
    headers: {
      "x-user-id": "user-1",
      "x-user-role": role,
      // A browser always sends the length of a FormData body; null models a chunked request.
      ...(contentLength === null ? {} : { "content-length": contentLength }),
      ...(contentType ? { "content-type": contentType } : {}),
    },
  });
}

function form(bytes: Buffer, type = "image/jpeg", password?: string) {
  const f = new FormData();
  if (password !== undefined) f.append("password", password);
  f.append("file", new Blob([new Uint8Array(bytes)], { type }), "foto.jpg");
  return f;
}

const added = { id: "p1", position: 0, r2Key: "service-orders/o1/p1.jpg" };

describe("POST /api/service-orders/[id]/photos", () => {
  it("201 with {id, position} only (no r2Key), and records the caller as creator", async () => {
    const addPhoto = vi.fn().mockResolvedValue(added);
    const res = await handleAddPhoto(req(form(JPEG)), "o1", { addPhoto });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "p1", position: 0 });
    expect(addPhoto).toHaveBeenCalledWith({ ordenId: "o1", bytes: JPEG, createdBy: "user-1", scope: expect.anything() });
    // a técnico's scope carries the assignment condition; an administrador's carries none
    expect(addPhoto.mock.calls[0][0].scope.where).toBeDefined();
  });

  it("hands the lock no condition for an administrador, who sees every order", async () => {
    const addPhoto = vi.fn().mockResolvedValue(added);
    await handleAddPhoto(req(form(JPEG), { role: "administrador" }), "o1", { addPhoto });
    expect(addPhoto.mock.calls[0][0].scope.where).toBeUndefined();
  });

  it("400 for a PNG even when it declares image/jpeg: the bytes decide, not the label", async () => {
    const addPhoto = vi.fn();
    const res = await handleAddPhoto(req(form(PNG, "image/jpeg")), "o1", { addPhoto });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "La foto tiene que ser JPEG" });
    expect(addPhoto).not.toHaveBeenCalled();
  });

  it("400 when no file field is sent", async () => {
    const addPhoto = vi.fn();
    const res = await handleAddPhoto(req(new FormData()), "o1", { addPhoto });

    expect(res.status).toBe(400);
    expect(addPhoto).not.toHaveBeenCalled();
  });

  it("413 from Content-Length alone, before the body is parsed (cap + 64 KB)", async () => {
    const addPhoto = vi.fn();
    const res = await handleAddPhoto(
      req(form(JPEG), { contentLength: String(MAX_PHOTO_BYTES + 64 * 1024 + 1) }),
      "o1",
      { addPhoto },
    );

    expect(res.status).toBe(413);
    expect(addPhoto).not.toHaveBeenCalled();
  });

  it("does not 413 a Content-Length exactly at cap + 64 KB", async () => {
    const addPhoto = vi.fn().mockResolvedValue(added);
    const res = await handleAddPhoto(
      req(form(JPEG), { contentLength: String(MAX_PHOTO_BYTES + 64 * 1024) }),
      "o1",
      { addPhoto },
    );

    expect(res.status).toBe(201);
  });

  it("413 from the real byte count when Content-Length lies", async () => {
    const addPhoto = vi.fn();
    const big = Buffer.concat([JPEG, Buffer.alloc(MAX_PHOTO_BYTES)]);
    const res = await handleAddPhoto(req(form(big), { contentLength: "100" }), "o1", { addPhoto });

    expect(res.status).toBe(413);
    expect(addPhoto).not.toHaveBeenCalled();
  });

  it("400 'No se pudo leer la foto' when the multipart body is malformed, not a 500", async () => {
    const addPhoto = vi.fn();
    const res = await handleAddPhoto(
      req("this is not multipart", { contentType: "multipart/form-data; boundary=xyz" }),
      "o1",
      { addPhoto },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No se pudo leer la foto" });
    expect(addPhoto).not.toHaveBeenCalled();
  });

  it("411 when there is no Content-Length (chunked), so an unbounded body is never buffered", async () => {
    const addPhoto = vi.fn();
    const res = await handleAddPhoto(req(form(JPEG), { contentLength: null }), "o1", { addPhoto });

    expect(res.status).toBe(411);
    expect(addPhoto).not.toHaveBeenCalled();
  });

  it("411 when Content-Length is not a number", async () => {
    const addPhoto = vi.fn();
    const res = await handleAddPhoto(req(form(JPEG), { contentLength: "abc" }), "o1", { addPhoto });

    expect(res.status).toBe(411);
    expect(addPhoto).not.toHaveBeenCalled();
  });

  it("404 when the order does not exist", async () => {
    const addPhoto = vi.fn().mockRejectedValue(new OrdenServicioNotFoundError("o1"));
    const res = await handleAddPhoto(req(form(JPEG)), "o1", { addPhoto });

    expect(res.status).toBe(404);
  });

  it("409 photo_limit with the Spanish message", async () => {
    const addPhoto = vi.fn().mockRejectedValue(new PhotoLimitError());
    const res = await handleAddPhoto(req(form(JPEG)), "o1", { addPhoto });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "photo_limit", message: "La orden ya tiene 12 fotos" });
  });

  it("409 order_closed with the Spanish message for an administrador with no password", async () => {
    const addPhoto = vi.fn().mockRejectedValue(new OrderClosedError());
    const authorize = vi.fn();
    const res = await handleAddPhoto(req(form(JPEG), { role: "administrador" }), "o1", { addPhoto, authorize });
    expect(authorize).not.toHaveBeenCalled();

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "order_closed",
      message: "La orden está cerrada",
    });
  });

  describe("a closed order (closed-order-lock)", () => {
    const closed = () => vi.fn().mockRejectedValue(new OrderClosedError());

    it.each([undefined, "pw"])("403 for a tecnico with password %s, and the password is never verified", async (password) => {
      const addPhoto = closed();
      const authorize = vi.fn();
      const res = await handleAddPhoto(req(form(JPEG, "image/jpeg", password), { role: "tecnico" }), "o1", { addPhoto, authorize });

      expect(res.status).toBe(403);
      expect(authorize).not.toHaveBeenCalled();
      expect(addPhoto).toHaveBeenCalledTimes(1);
    });

    it("403 wrong_password when the administrator's password is wrong, and nothing is retried", async () => {
      const addPhoto = closed();
      const authorize = vi.fn().mockRejectedValue(new CorrectionRefusedError("wrong_password"));
      const res = await handleAddPhoto(req(form(JPEG, "image/jpeg", "bad"), { role: "administrador" }), "o1", { addPhoto, authorize });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "wrong_password", message: "Contraseña incorrecta" });
      expect(addPhoto).toHaveBeenCalledTimes(1);
    });

    it("429 with Retry-After 900 when throttled", async () => {
      const authorize = vi.fn().mockRejectedValue(new CorrectionRefusedError("throttled"));
      const res = await handleAddPhoto(req(form(JPEG, "image/jpeg", "pw"), { role: "administrador" }), "o1", {
        addPhoto: closed(),
        authorize,
      });

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("900");
      expect(await res.json()).toEqual({ error: "throttled", message: "Demasiados intentos. Probá de nuevo en 15 minutos." });
    });

    it("verifies the password, then retries WITH the grant and answers 201", async () => {
      const addPhoto = vi.fn().mockRejectedValueOnce(new OrderClosedError()).mockResolvedValueOnce(added);
      const authorize = vi.fn().mockResolvedValue({ correctorId: "user-1" });
      const res = await handleAddPhoto(req(form(JPEG, "image/jpeg", "pw"), { role: "administrador" }), "o1", { addPhoto, authorize });

      expect(res.status).toBe(201);
      expect(authorize).toHaveBeenCalledWith("user-1", "pw");
      expect(addPhoto).toHaveBeenNthCalledWith(1, { ordenId: "o1", bytes: JPEG, createdBy: "user-1", scope: expect.anything() });
      expect(addPhoto).toHaveBeenNthCalledWith(2, {
        ordenId: "o1",
        bytes: JPEG,
        createdBy: "user-1",
        scope: expect.anything(),
        correction: { correctorId: "user-1" },
      });
    });

    it("never verifies a password sent for an OPEN order", async () => {
      const authorize = vi.fn();
      const res = await handleAddPhoto(req(form(JPEG, "image/jpeg", "pw"), { role: "administrador" }), "o1", {
        addPhoto: vi.fn().mockResolvedValue(added),
        authorize,
      });

      expect(res.status).toBe(201);
      expect(authorize).not.toHaveBeenCalled();
    });
  });

  it("rethrows an unexpected failure instead of answering 4xx", async () => {
    const addPhoto = vi.fn().mockRejectedValue(new Error("r2 down"));
    await expect(handleAddPhoto(req(form(JPEG)), "o1", { addPhoto })).rejects.toThrow("r2 down");
  });

  it("refuses a request with no session", async () => {
    const request = new NextRequest("http://localhost/api/service-orders/o1/photos", { method: "POST" });
    await expect(POST(request, { params: Promise.resolve({ id: "o1" }) })).rejects.toThrow();
  });
});
