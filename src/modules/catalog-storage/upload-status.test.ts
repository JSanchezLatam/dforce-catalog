import type { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import type { db } from "@/shared/db/client";
import type { PdfUploadPayload } from "../pdf-generation/worker";
import { buildCatalogPdfKey, handlePdfUpload, isFinalAttempt, registerPdfUploadWorker } from "./upload-status";
import { PDF_UPLOAD_JOB } from "../pdf-generation/enqueue";

// WU4 (design.md decision 18) — capture.ts's withJobCapture defaults its
// `report` param to Sentry.captureException; mocking it here lets the
// registerPdfUploadWorker test below assert on the real wiring without a
// live Sentry transport. vi.hoisted is required because "./upload-status"
// above is a STATIC import that resolves "@sentry/nextjs" via capture.ts
// before any later bare top-level const would run (see reminders/job.test.ts's
// fuller comment on this exact TDZ trap).
const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

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

describe("registerPdfUploadWorker", () => {
  it("wraps the boss.work handler with withJobCapture: a throw is reported with job/jobId tags and pg-boss still sees the rejection", async () => {
    captureException.mockClear();
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue(undefined);
    const boss = { createQueue, work } as unknown as PgBoss;

    await registerPdfUploadWorker({ getBoss: async () => boss });

    expect(work).toHaveBeenCalledWith(PDF_UPLOAD_JOB, { includeMetadata: true }, expect.any(Function));
    const registeredHandler = work.mock.calls[0][2] as (jobs: unknown[]) => Promise<void>;
    // Empty jobs array: the site's callback reads `jobs[0]`, which is
    // undefined, so `handlePdfUpload(undefined, ...)`'s destructuring of
    // `job.data` throws synchronously — a deterministic failure that needs
    // no real DB.
    await expect(registeredHandler([])).rejects.toBeInstanceOf(TypeError);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(expect.any(TypeError), {
      tags: { job: PDF_UPLOAD_JOB, jobId: "unknown" },
    });
  });
});
