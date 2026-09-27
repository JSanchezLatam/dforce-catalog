/**
 * See instrumentation.ts's header for why ordering matters: Sentry must be
 * initialized before the pg-boss worker bootstrap so a bootstrap failure is
 * itself captured (design.md decision 13, spec.md "Server-Side Error
 * Capture Ordering"). Both `./instrumentation-node` and `@sentry/nextjs` are
 * mocked at the module boundary — this test asserts call order and
 * conditional invocation, not SDK internals.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const registerNodeWorkers = vi.fn().mockResolvedValue(undefined);
vi.mock("./instrumentation-node", () => ({
  registerNodeWorkers,
}));

const init = vi.fn();
const captureException = vi.fn();
const captureRequestError = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  init,
  captureException,
  captureRequestError,
}));

const VALID_DSN = "https://public@o0.ingest.sentry.io/0";

describe("instrumentation register()", () => {
  afterEach(() => {
    delete process.env.NEXT_RUNTIME;
    delete process.env.SENTRY_DSN;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("initializes Sentry before the pg-boss worker bootstrap runs", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.SENTRY_DSN = VALID_DSN;

    const { register } = await import("./instrumentation");
    await register();

    expect(init).toHaveBeenCalledTimes(1);
    expect(registerNodeWorkers).toHaveBeenCalledTimes(1);
    expect(init.mock.invocationCallOrder[0]).toBeLessThan(
      registerNodeWorkers.mock.invocationCallOrder[0],
    );
  });

  it("does not initialize Sentry when SENTRY_DSN is unset, but still runs the worker bootstrap", async () => {
    process.env.NEXT_RUNTIME = "nodejs";

    const { register } = await import("./instrumentation");
    await register();

    expect(init).not.toHaveBeenCalled();
    expect(registerNodeWorkers).toHaveBeenCalledTimes(1);
  });

  it("runs neither Sentry init nor the worker bootstrap when NEXT_RUNTIME is not nodejs", async () => {
    process.env.SENTRY_DSN = VALID_DSN;

    const { register } = await import("./instrumentation");
    await register();

    expect(init).not.toHaveBeenCalled();
    expect(registerNodeWorkers).not.toHaveBeenCalled();
  });

  it("captures a worker bootstrap failure with Sentry and rethrows it unchanged", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.SENTRY_DSN = VALID_DSN;
    const boom = new Error("boom");
    registerNodeWorkers.mockRejectedValueOnce(boom);

    const { register } = await import("./instrumentation");

    await expect(register()).rejects.toBe(boom);
    expect(captureException).toHaveBeenCalledWith(boom);
  });
});
