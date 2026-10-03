/**
 * The download filename is built from `catalogs.title`, which is now text the
 * operator typed. `Headers` rejects a value with a character above U+00FF, and
 * a `"` ends the quoted `filename=` early, so the title cannot be interpolated
 * as it was. These tests use the REAL `NextResponse`/`Headers`: a mocked
 * response would accept the "—" that production refuses.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCatalogById = vi.hoisted(() => vi.fn());
const getObject = vi.hoisted(() => vi.fn());

vi.mock("@/modules/catalog-storage/queries", () => ({ getCatalogById }));
vi.mock("@/modules/catalog-storage/r2", () => ({ getObject }));

import { GET } from "./route";

function catalog(title: string) {
  return { id: "c1", userId: "user-1", title, uploadStatus: "uploaded", r2Key: "catalogs/c1.pdf" };
}

function fileRequest(query = "?download=1") {
  return new NextRequest(`http://localhost/api/catalogs/c1/file${query}`, {
    headers: { "x-user-id": "user-1", "x-user-role": "administrador" },
  });
}

const call = (query?: string) => GET(fileRequest(query), { params: Promise.resolve({ id: "c1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  getObject.mockResolvedValue(Buffer.from("%PDF"));
});

describe("GET /api/catalogs/[id]/file — Content-Disposition", () => {
  it("answers 200 for a title with a double quote and an em dash, preserving it in filename*", async () => {
    getCatalogById.mockResolvedValue(catalog('Catálogo: Audio "pro" — 2026'));

    const response = await call();

    expect(response.status).toBe(200);
    const disposition = response.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''/);
    // The ASCII fallback holds no raw quote besides the two that delimit it.
    expect(disposition.match(/filename="([^;]*)"/)?.[1]).not.toContain('"');
    const encoded = disposition.split("filename*=UTF-8''")[1];
    expect(decodeURIComponent(encoded)).toBe('Catálogo: Audio "pro" — 2026.pdf');
  });

  it("escapes the characters RFC 5987 does not allow unescaped", async () => {
    getCatalogById.mockResolvedValue(catalog("Audio (pro) *'x'"));

    const disposition = (await call()).headers.get("Content-Disposition") ?? "";

    expect(disposition.split("filename*=UTF-8''")[1]).not.toMatch(/['()*]/);
  });

  it("keeps the inline/attachment split", async () => {
    getCatalogById.mockResolvedValue(catalog("Catálogo"));

    expect((await call("")).headers.get("Content-Disposition")).toMatch(/^inline; /);
    expect((await call("?download=1")).headers.get("Content-Disposition")).toMatch(/^attachment; /);
  });
});
