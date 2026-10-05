import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/modules/auth/roles";
import { MAX_PHOTO_BYTES, OrderClosedError, PhotoLimitError } from "@/modules/service-orders/photos";
import { OrdenServicioNotFoundError } from "@/modules/service-orders/service";
import { handleAddPhoto, POST } from "./route";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function req(
  body: BodyInit | undefined,
  { role = "tecnico", contentLength }: { role?: Role; contentLength?: string } = {},
) {
  return new NextRequest("http://localhost/api/service-orders/o1/photos", {
    method: "POST",
    body,
    headers: {
      "x-user-id": "user-1",
      "x-user-role": role,
      ...(contentLength ? { "content-length": contentLength } : {}),
    },
  });
}

function form(bytes: Buffer, type = "image/jpeg") {
  const f = new FormData();
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
    expect(addPhoto).toHaveBeenCalledWith({ ordenId: "o1", bytes: JPEG, createdBy: "user-1" });
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

  it("409 order_closed with the Spanish message", async () => {
    const addPhoto = vi.fn().mockRejectedValue(new OrderClosedError());
    const res = await handleAddPhoto(req(form(JPEG)), "o1", { addPhoto });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "order_closed",
      message: "La orden está cerrada; no se pueden cambiar sus fotos",
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
