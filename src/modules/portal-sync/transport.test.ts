import { verify } from "@portal/contract";
import { describe, expect, it, vi } from "vitest";

import { PortalRejectedError, sendToPortal } from "./transport";

const SECRET = "test-secret";
const body = { kind: "delete", clienteId: "c1", version: 3 } as const;

function fakeFetch(status: number) {
  return vi.fn<typeof fetch>(async () => new Response("{}", { status }));
}
const cfg = (url: string) => ({ url, secret: SECRET });

describe("sendToPortal", () => {
  it("signs the exact bytes it sends, in a way the portal's verify accepts", async () => {
    const f = fakeFetch(200);
    await sendToPortal(body, cfg("https://portal.example/api/ingest"), f);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://portal.example/api/ingest");
    expect(init?.method).toBe("POST");
    const sent = init?.body as string;
    expect(JSON.parse(sent)).toEqual(body);
    const headers = new Headers(init?.headers);
    expect(headers.get("x-portal-timestamp")).toBeTruthy();
    expect(verify(sent, headers, SECRET)).toBe(true);
    expect(verify(sent, headers, "other-secret")).toBe(false);
  });

  it("refuses plain http for a remote host before any request", async () => {
    const f = fakeFetch(200);
    await expect(sendToPortal(body, cfg("http://portal.example/api/ingest"), f)).rejects.toBeInstanceOf(PortalRejectedError);
    expect(f).not.toHaveBeenCalled();
  });

  it.each(["http://localhost:3001/api/ingest", "http://127.0.0.1:3001/api/ingest", "https://x.example/api/ingest"])(
    "allows %s",
    async (url) => {
      const f = fakeFetch(200);
      await sendToPortal(body, cfg(url), f);
      expect(f).toHaveBeenCalledOnce();
    },
  );

  it("refuses a host that merely starts with localhost", async () => {
    const f = fakeFetch(200);
    await expect(sendToPortal(body, cfg("http://localhost.evil.example/x"), f)).rejects.toBeInstanceOf(PortalRejectedError);
  });

  it("throws a retryable error on 5xx", async () => {
    const err = await sendToPortal(body, cfg("https://p.example/i"), fakeFetch(503)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PortalRejectedError);
  });

  it("lets a network error through to be retried", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const err = await sendToPortal(body, cfg("https://p.example/i"), f).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
  });

  it("throws a non-retry error on 4xx", async () => {
    await expect(sendToPortal(body, cfg("https://p.example/i"), fakeFetch(400))).rejects.toBeInstanceOf(PortalRejectedError);
    await expect(sendToPortal(body, cfg("https://p.example/i"), fakeFetch(401))).rejects.toBeInstanceOf(PortalRejectedError);
  });

  it("completes on a 2xx whatever the body says (a stale acknowledgement is not a failure)", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ applied: false }), { status: 200 }));
    await expect(sendToPortal(body, cfg("https://p.example/i"), f)).resolves.toBeUndefined();
  });
});
