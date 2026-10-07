import { afterEach, describe, expect, it, vi } from "vitest";

import { SENSITIVE_ENV_KEYS } from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("portal sync environment", () => {
  it("treats the ingest secret as sensitive", () => {
    expect(SENSITIVE_ENV_KEYS).toContain("PORTAL_INGEST_SECRET");
  });

  it("reads both variables from the process environment", async () => {
    vi.stubEnv("PORTAL_INGEST_URL", "http://localhost:3001/api/ingest");
    vi.stubEnv("PORTAL_INGEST_SECRET", "s3cret");
    vi.resetModules();
    const { env } = await import("./env");
    expect(env.PORTAL_INGEST_URL).toBe("http://localhost:3001/api/ingest");
    expect(env.PORTAL_INGEST_SECRET).toBe("s3cret");
  });

  it("is inert (undefined) when unset", async () => {
    vi.stubEnv("PORTAL_INGEST_URL", undefined);
    vi.stubEnv("PORTAL_INGEST_SECRET", undefined);
    vi.resetModules();
    const { env } = await import("./env");
    expect(env.PORTAL_INGEST_URL).toBeUndefined();
    expect(env.PORTAL_INGEST_SECRET).toBeUndefined();
  });
});
