import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST, DELETE } from "./route";

const { mockList, mockUpsert, mockRemove, mockPutObject, mockGetObject, mockDeleteObject } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockUpsert: vi.fn(),
  mockRemove: vi.fn(),
  mockPutObject: vi.fn(),
  mockGetObject: vi.fn(),
  mockDeleteObject: vi.fn(),
}));

vi.mock("@/modules/template-config/service", () => ({
  listTemplateCoverImages: (...args: unknown[]) => mockList(...args),
  upsertTemplateCoverImage: (...args: unknown[]) => mockUpsert(...args),
  deleteTemplateCoverImage: (...args: unknown[]) => mockRemove(...args),
}));

vi.mock("@/modules/catalog-storage/r2", () => ({
  putObject: (...args: unknown[]) => mockPutObject(...args),
  getObject: (...args: unknown[]) => mockGetObject(...args),
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
}));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function req(role: string, options?: { method?: string; body?: BodyInit; contentLength?: string }) {
  return new NextRequest("http://localhost/api/template-config/cover-image/x", {
    method: options?.method,
    body: options?.body,
    headers: {
      "x-user-id": "user-1",
      "x-user-role": role,
      ...(options?.contentLength ? { "content-length": options.contentLength } : {}),
    },
  });
}

const ctx = (templateId: string) => ({ params: Promise.resolve({ templateId }) });

function pngForm() {
  const form = new FormData();
  form.append("file", new Blob([PNG], { type: "image/png" }), "cover.png");
  return form;
}

// Row shape is what `listTemplateCoverImages` returns (Drizzle's $inferSelect).
const row = (templateId: string, r2Key: string, contentType = "image/png") => ({
  templateId,
  r2Key,
  contentType,
  updatedAt: new Date(),
});

/**
 * catalog-cover-templates WU3a — copies `workshop-config/cover-image/route.test.ts`
 * and adds the unknown-id 404 and the cross-template isolation cases (design
 * "Testing"). The permission is `template.edit` for every method, GET too.
 */
describe("template-config cover-image/[templateId] route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockList.mockResolvedValue([]);
    mockUpsert.mockResolvedValue(null);
    mockRemove.mockResolvedValue(null);
    mockGetObject.mockResolvedValue(null);
    mockDeleteObject.mockResolvedValue(undefined);
  });

  describe("unknown template id", () => {
    it("GET responds 404", async () => {
      const res = await GET(req("administrador"), ctx("no-such-template"));
      expect(res.status).toBe(404);
      expect(mockList).not.toHaveBeenCalled();
    });

    it("POST responds 404 and stores nothing", async () => {
      const res = await POST(req("administrador", { method: "POST", body: pngForm() }), ctx("no-such-template"));
      expect(res.status).toBe(404);
      expect(mockPutObject).not.toHaveBeenCalled();
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it("DELETE responds 404 and removes nothing", async () => {
      const res = await DELETE(req("administrador", { method: "DELETE" }), ctx("no-such-template"));
      expect(res.status).toBe(404);
      expect(mockRemove).not.toHaveBeenCalled();
    });
  });

  describe("template.edit gating", () => {
    it("POST: tecnico gets 403 and nothing is stored", async () => {
      const res = await POST(req("tecnico", { method: "POST", body: pngForm() }), ctx("full-cover"));
      expect(res.status).toBe(403);
      expect(mockPutObject).not.toHaveBeenCalled();
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it("DELETE: tecnico gets 403 and nothing is removed", async () => {
      const res = await DELETE(req("tecnico", { method: "DELETE" }), ctx("full-cover"));
      expect(res.status).toBe(403);
      expect(mockRemove).not.toHaveBeenCalled();
      expect(mockDeleteObject).not.toHaveBeenCalled();
    });

    it("GET: tecnico gets 403 (template.edit, not workshop.read)", async () => {
      mockList.mockResolvedValue([row("full-cover", "covers/full-cover/1.png")]);
      const res = await GET(req("tecnico"), ctx("full-cover"));
      expect(res.status).toBe(403);
    });
  });

  describe("POST", () => {
    it("stores the object under covers/<id>/<ts>.<ext> and records that key for the template", async () => {
      mockPutObject.mockResolvedValue("https://r2.dev/key.png");

      const res = await POST(req("administrador", { method: "POST", body: pngForm() }), ctx("full-cover"));

      expect(res.status).toBe(200);
      const key = mockPutObject.mock.calls[0][0] as string;
      expect(key).toMatch(/^covers\/full-cover\/\d+\.png$/);
      expect(mockPutObject.mock.calls[0][2]).toBe("image/png");
      expect(mockUpsert).toHaveBeenCalledWith("full-cover", { r2Key: key, contentType: "image/png" });
      expect(await res.json()).toEqual({ key });
    });

    it("deletes the previous object when replacing, and only that one", async () => {
      mockPutObject.mockResolvedValue("https://r2.dev/key.png");
      mockUpsert.mockResolvedValue("covers/full-cover/old.png");

      await POST(req("administrador", { method: "POST", body: pngForm() }), ctx("full-cover"));

      expect(mockDeleteObject).toHaveBeenCalledTimes(1);
      expect(mockDeleteObject).toHaveBeenCalledWith("covers/full-cover/old.png");
    });

    it("deletes nothing when there was no previous image", async () => {
      mockPutObject.mockResolvedValue("https://r2.dev/key.png");
      mockUpsert.mockResolvedValue(null);

      await POST(req("administrador", { method: "POST", body: pngForm() }), ctx("full-cover"));

      expect(mockDeleteObject).not.toHaveBeenCalled();
    });

    it("still answers 200 when deleting the previous object fails", async () => {
      mockPutObject.mockResolvedValue("https://r2.dev/key.png");
      mockUpsert.mockResolvedValue("covers/full-cover/old.png");
      mockDeleteObject.mockRejectedValue(new Error("r2 down"));

      const res = await POST(req("administrador", { method: "POST", body: pngForm() }), ctx("full-cover"));

      expect(res.status).toBe(200);
    });

    it("rejects an invalid file format with 400", async () => {
      const form = new FormData();
      form.append("file", new Blob(["not-an-image"]), "test.txt");

      const res = await POST(req("administrador", { method: "POST", body: form }), ctx("full-cover"));

      expect(res.status).toBe(400);
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it("rejects an SVG cover with 400 and stores nothing", async () => {
      const form = new FormData();
      form.append("file", new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], { type: "image/svg+xml" }), "c.svg");

      const res = await POST(req("administrador", { method: "POST", body: form }), ctx("full-cover"));

      expect(res.status).toBe(400);
      expect(mockPutObject).not.toHaveBeenCalled();
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it("rejects when no file is provided", async () => {
      const res = await POST(req("administrador", { method: "POST", body: new FormData() }), ctx("full-cover"));
      expect(res.status).toBe(400);
    });

    it("rejects a declared Content-Length over the 2MB cap with 413, BEFORE buffering the body", async () => {
      const res = await POST(
        req("administrador", { method: "POST", body: pngForm(), contentLength: String(3 * 1024 * 1024) }),
        ctx("full-cover"),
      );

      expect(res.status).toBe(413);
      expect(mockPutObject).not.toHaveBeenCalled();
    });

    it("cross-template isolation: uploading for one template writes only that template's id", async () => {
      mockPutObject.mockResolvedValue("https://r2.dev/key.png");

      await POST(req("administrador", { method: "POST", body: pngForm() }), ctx("dforce-classic"));

      expect(mockUpsert).toHaveBeenCalledTimes(1);
      expect(mockUpsert.mock.calls[0][0]).toBe("dforce-classic");
      expect(mockRemove).not.toHaveBeenCalled();
    });
  });

  describe("DELETE", () => {
    it("removes the row and then the stored object", async () => {
      mockRemove.mockResolvedValue("covers/full-cover/1.png");

      const res = await DELETE(req("administrador", { method: "DELETE" }), ctx("full-cover"));

      expect(res.status).toBe(200);
      expect(mockRemove).toHaveBeenCalledWith("full-cover");
      expect(mockDeleteObject).toHaveBeenCalledWith("covers/full-cover/1.png");
    });

    it("still answers 200 when the R2 delete fails (the row is already gone)", async () => {
      mockRemove.mockResolvedValue("covers/full-cover/1.png");
      mockDeleteObject.mockRejectedValue(new Error("r2 down"));

      const res = await DELETE(req("administrador", { method: "DELETE" }), ctx("full-cover"));

      expect(res.status).toBe(200);
    });

    it("deletes no object when the template had no image", async () => {
      mockRemove.mockResolvedValue(null);

      const res = await DELETE(req("administrador", { method: "DELETE" }), ctx("full-cover"));

      expect(res.status).toBe(200);
      expect(mockDeleteObject).not.toHaveBeenCalled();
    });
  });

  describe("GET", () => {
    it("serves the template's own image with the sandbox security headers", async () => {
      mockList.mockResolvedValue([
        row("dforce-classic", "covers/dforce-classic/1.png"),
        row("full-cover", "covers/full-cover/2.jpg", "image/jpeg"),
      ]);
      mockGetObject.mockResolvedValue(Buffer.from([0xff, 0xd8]));

      const res = await GET(req("administrador"), ctx("full-cover"));

      expect(res.status).toBe(200);
      expect(mockGetObject).toHaveBeenCalledWith("covers/full-cover/2.jpg");
      expect(res.headers.get("Content-Type")).toBe("image/jpeg");
      expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Cache-Control")).toMatch(/private/);
      expect(res.headers.get("ETag")).toBe("covers/full-cover/2.jpg");
    });

    it("returns 404 when only ANOTHER template has an image", async () => {
      mockList.mockResolvedValue([row("dforce-classic", "covers/dforce-classic/1.png")]);

      const res = await GET(req("administrador"), ctx("full-cover"));

      expect(res.status).toBe(404);
      expect(mockGetObject).not.toHaveBeenCalled();
    });

    it("returns 404 when the R2 object is missing", async () => {
      mockList.mockResolvedValue([row("full-cover", "covers/full-cover/gone.png")]);
      mockGetObject.mockResolvedValue(null);

      const res = await GET(req("administrador"), ctx("full-cover"));

      expect(res.status).toBe(404);
    });
  });
});
