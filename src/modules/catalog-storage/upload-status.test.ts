import { describe, expect, it, vi } from "vitest";

import type { db } from "@/shared/db/client";
import type { PdfUploadPayload } from "../pdf-generation/worker";
import { buildCatalogPdfKey, handlePdfUpload, isFinalAttempt } from "./upload-status";

const PAYLOAD: PdfUploadPayload = {
  catalogId: "cat-1",
  userId: "user-1",
  pdfBufferRef: "/tmp/dforce-catalog-pdfs/cat-1.pdf",
};

/** Fake `db.update(...).set(...).where(...)` chain (same style as inventory-sync/job.test.ts's `fakeDb`). */
function fakeDatabase() {
  const updates: Record<string, unknown>[] = [];
  const database = {
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          updates.push(patch);
        },
      }),
    }),
  };
  return { database: database as unknown as typeof db, updates };
}

describe("isFinalAttempt — pure predicate over pg-boss's retryCount/retryLimit", () => {
  it("is false while retries remain, true once retryCount reaches retryLimit", () => {
    expect(isFinalAttempt({ retryCount: 0, retryLimit: 2 })).toBe(false);
    expect(isFinalAttempt({ retryCount: 1, retryLimit: 2 })).toBe(false);
    expect(isFinalAttempt({ retryCount: 2, retryLimit: 2 })).toBe(true);
  });
});

describe("buildCatalogPdfKey", () => {
  it("namespaces the R2 key under catalogs/", () => {
    expect(buildCatalogPdfKey("cat-1")).toBe("catalogs/cat-1.pdf");
  });
});

describe("handlePdfUpload — Risk-1 upload_status state machine (R11.5)", () => {
  it("marks uploading -> uploaded, deletes the temp file, and runs retention on success", async () => {
    const { database, updates } = fakeDatabase();
    const readFile = vi.fn().mockResolvedValue(Buffer.from("pdf-bytes"));
    const unlink = vi.fn().mockResolvedValue(undefined);
    const putObject = vi.fn().mockResolvedValue("https://example.r2.dev/catalogs/cat-1.pdf");
    const runRetentionForUser = vi.fn().mockResolvedValue({ evictedIds: [] });

    await handlePdfUpload(
      { data: PAYLOAD, retryCount: 0, retryLimit: 2 },
      { database, readFile, unlink, putObject, runRetentionForUser },
    );

    expect(updates[0]).toEqual({ uploadStatus: "uploading" });
    expect(updates[1]).toEqual({
      uploadStatus: "uploaded",
      r2Key: "catalogs/cat-1.pdf",
      r2Url: "https://example.r2.dev/catalogs/cat-1.pdf",
    });
    expect(unlink).toHaveBeenCalledWith(PAYLOAD.pdfBufferRef);
    expect(runRetentionForUser).toHaveBeenCalledWith("user-1");
  });

  it("on a non-final failure, rethrows without marking failed and keeps the temp file for pg-boss's retry", async () => {
    const { database, updates } = fakeDatabase();
    const readFile = vi.fn().mockResolvedValue(Buffer.from("pdf-bytes"));
    const unlink = vi.fn();
    const putObject = vi.fn().mockRejectedValue(new Error("R2 unreachable"));

    await expect(
      handlePdfUpload({ data: PAYLOAD, retryCount: 0, retryLimit: 2 }, { database, readFile, unlink, putObject }),
    ).rejects.toThrow("R2 unreachable");

    expect(updates).toEqual([{ uploadStatus: "uploading" }]);
    expect(unlink).not.toHaveBeenCalled();
  });

  it("on the final failed attempt, marks uploadStatus failed and deletes the temp file, then still rethrows", async () => {
    const { database, updates } = fakeDatabase();
    const readFile = vi.fn().mockResolvedValue(Buffer.from("pdf-bytes"));
    const unlink = vi.fn().mockResolvedValue(undefined);
    const putObject = vi.fn().mockRejectedValue(new Error("R2 unreachable"));

    await expect(
      handlePdfUpload(
        { data: PAYLOAD, retryCount: 2, retryLimit: 2 },
        { database, readFile, unlink, putObject },
      ),
    ).rejects.toThrow("R2 unreachable");

    expect(updates).toEqual([{ uploadStatus: "uploading" }, { uploadStatus: "failed" }]);
    expect(unlink).toHaveBeenCalledWith(PAYLOAD.pdfBufferRef);
  });
});
