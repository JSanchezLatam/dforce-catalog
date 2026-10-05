import { beforeEach, describe, expect, it, vi } from "vitest";

const S3ClientCtor = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-s3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aws-sdk/client-s3")>()),
  S3Client: S3ClientCtor,
}));

/**
 * Newer SDK versions default to computing a CRC32 checksum on every request and
 * validating it on every response. R2 does not accept that default on a PUT, and
 * `scripts/upload-backup.mjs` already opts out for the same reason, so the
 * client must ask for checksums only where the protocol requires one.
 */
describe("r2 client construction", () => {
  beforeEach(() => {
    S3ClientCtor.mockClear();
    vi.resetModules();
  });

  it("computes and validates checksums only when required", async () => {
    await import("./r2");

    expect(S3ClientCtor).toHaveBeenCalledTimes(1);
    expect(S3ClientCtor.mock.calls[0][0]).toMatchObject({
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  });

  it("keeps the R2 region and endpoint settings", async () => {
    await import("./r2");

    expect(S3ClientCtor.mock.calls[0][0]).toMatchObject({ region: "auto" });
  });
});
