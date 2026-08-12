import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST, DELETE } from "./route";

const { mockGetConfig, mockSaveConfig, mockPutObject, mockGetObject, mockDeleteObject } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockPutObject: vi.fn(),
  mockGetObject: vi.fn().mockResolvedValue(null),
  mockDeleteObject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/workshop-config/service", () => ({
  getWorkshopConfig: (...args: unknown[]) => mockGetConfig(...args),
  saveWorkshopConfig: (...args: unknown[]) => mockSaveConfig(...args),
}));

vi.mock("@/modules/catalog-storage/r2", () => ({
  putObject: (...args: unknown[]) => mockPutObject(...args),
  getObject: (...args: unknown[]) => mockGetObject(...args),
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
}));

function req(role: string, options?: { method?: string; body?: BodyInit; contentLength?: string }) {
  return new NextRequest("http://localhost/api/workshop-config/cover-image", {
    method: options?.method,
    body: options?.body,
    headers: {
      "x-user-id": "user-1",
      "x-user-role": role,
      ...(options?.contentLength ? { "content-length": options.contentLength } : {}),
    },
  });
}

const mockConfig = (overrides = {}) => ({
  id: "singleton", name: "Taller", coverImageR2Key: null, coverImageContentType: null, updatedAt: new Date(), ...overrides,
});

/**
 * Mirrors logo/route.test.ts exactly (design D6 / task 6.4): same upload
 * idiom, same admin-gating, same partial-touch discipline. The one test
 * unique to this route pins the exact bug WU1's apply-progress recorded on
 * the logo route (resending `name` on every save and clobbering it).
 */
describe("workshop-config cover-image route", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("POST — workshop.edit (admin only)", () => {
    it("uploads a valid PNG and saves the key", async () => {
      mockGetConfig.mockResolvedValue(mockConfig());
      mockPutObject.mockResolvedValue("https://r2.dev/key.png");

      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const form = new FormData();
      form.append("file", new Blob([png], { type: "image/png" }), "cover.png");

      const res = await POST(req("administrador", { method: "POST", body: form }));
      expect(res.status).toBe(200);
      expect(mockPutObject).toHaveBeenCalledOnce();
    });

    it("rejects tecnico with 403", async () => {
      const res = await POST(req("tecnico", { method: "POST" }));
      expect(res.status).toBe(403);
    });

    it("rejects an invalid file format", async () => {
      const form = new FormData();
      form.append("file", new Blob(["not-an-image"]), "test.txt");

      const res = await POST(req("administrador", { method: "POST", body: form }));
      expect(res.status).toBe(400);
    });

    it("rejects when no file is provided", async () => {
      const form = new FormData();
      const res = await POST(req("administrador", { method: "POST", body: form }));
      expect(res.status).toBe(400);
    });

    it("rejects a declared Content-Length over the 2MB cap with 413, BEFORE buffering the body", async () => {
      const form = new FormData();
      form.append("file", new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])]), "cover.png");

      const res = await POST(
        req("administrador", { method: "POST", body: form, contentLength: String(3 * 1024 * 1024) }),
      );

      expect(res.status).toBe(413);
      expect(mockPutObject).not.toHaveBeenCalled();
    });

    it("deletes the previous cover image when replacing", async () => {
      mockGetConfig.mockResolvedValue(mockConfig({ coverImageR2Key: "old-key", coverImageContentType: "image/png" }));
      mockPutObject.mockResolvedValue("https://r2.dev/key.png");

      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const form = new FormData();
      form.append("file", new Blob([png], { type: "image/png" }), "cover.png");

      await POST(req("administrador", { method: "POST", body: form }));
      expect(mockDeleteObject).toHaveBeenCalledWith("old-key");
    });

    // Pins the exact bug WU1's apply-progress recorded on the logo route:
    // resending `name` on every save clobbered it because saveWorkshopConfig
    // now treats a present-but-different `name` as an explicit overwrite.
    it("does not resend name when saving the uploaded cover image key", async () => {
      mockGetConfig.mockResolvedValue(mockConfig({ name: "Taller Existente" }));
      mockPutObject.mockResolvedValue("https://r2.dev/key.png");

      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const form = new FormData();
      form.append("file", new Blob([png], { type: "image/png" }), "cover.png");

      await POST(req("administrador", { method: "POST", body: form }));
      expect(mockSaveConfig).toHaveBeenCalledOnce();
      expect(mockSaveConfig.mock.calls[0][0]).not.toHaveProperty("name");
    });
  });

  describe("DELETE — workshop.edit (admin only)", () => {
    it("clears the cover image key and content type", async () => {
      mockGetConfig.mockResolvedValue(mockConfig({ coverImageR2Key: "some-key" }));

      const res = await DELETE(req("administrador", { method: "DELETE" }));
      expect(res.status).toBe(200);
      expect(mockSaveConfig).toHaveBeenCalled();
    });

    it("does not resend name when clearing the cover image", async () => {
      mockGetConfig.mockResolvedValue(mockConfig({ name: "Taller Existente", coverImageR2Key: "some-key" }));

      await DELETE(req("administrador", { method: "DELETE" }));
      expect(mockSaveConfig.mock.calls[0][0]).not.toHaveProperty("name");
    });

    it("rejects tecnico with 403", async () => {
      const res = await DELETE(req("tecnico", { method: "DELETE" }));
      expect(res.status).toBe(403);
    });
  });

  describe("GET — workshop.read (both roles)", () => {
    it("returns the cover image with security headers", async () => {
      mockGetConfig.mockResolvedValue(mockConfig({ coverImageR2Key: "covers/key.png", coverImageContentType: "image/png" }));
      mockGetObject.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const res = await GET(req("tecnico"));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Cache-Control")).toMatch(/private/);
    });

    it("returns 404 when no cover image is stored", async () => {
      mockGetConfig.mockResolvedValue(mockConfig({ coverImageR2Key: null }));

      const res = await GET(req("administrador"));
      expect(res.status).toBe(404);
    });

    it("returns 404 when R2 object is missing", async () => {
      mockGetConfig.mockResolvedValue(mockConfig({ coverImageR2Key: "covers/missing.png", coverImageContentType: "image/png" }));
      mockGetObject.mockResolvedValue(null);

      const res = await GET(req("tecnico"));
      expect(res.status).toBe(404);
    });
  });
});
