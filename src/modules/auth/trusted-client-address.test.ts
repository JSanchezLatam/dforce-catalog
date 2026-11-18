import http from "node:http";

import { describe, expect, it, vi } from "vitest";

import { installTrustedClientAddress, trustedForwardedFor } from "./trusted-client-address";

describe("trustedForwardedFor", () => {
  it("replaces a forged header with the address of the connection", () => {
    expect(trustedForwardedFor("192.168.1.23", "10.0.0.9")).toBe("192.168.1.23");
  });

  it("sets the address when the client sent no header", () => {
    expect(trustedForwardedFor("::ffff:192.168.1.23", undefined)).toBe("::ffff:192.168.1.23");
  });

  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])("keeps the header from a local proxy at %s", (address) => {
    expect(trustedForwardedFor(address, "181.197.1.1")).toBe("181.197.1.1");
  });

  it("drops the header when the connection address is unknown", () => {
    expect(trustedForwardedFor(undefined, "10.0.0.9")).toBeUndefined();
  });
});

describe("installTrustedClientAddress", () => {
  it("rewrites the header before request listeners run, and installs only once", () => {
    installTrustedClientAddress();
    const patched = http.Server.prototype.emit;
    installTrustedClientAddress();
    expect(http.Server.prototype.emit).toBe(patched);

    const server = http.createServer();
    const listener = vi.fn();
    server.on("request", listener);
    const request = { headers: { "x-forwarded-for": "10.0.0.9" }, socket: { remoteAddress: "192.168.1.23" } };

    server.emit("request", request, {});

    expect(listener).toHaveBeenCalledOnce();
    expect(request.headers["x-forwarded-for"]).toBe("192.168.1.23");
  });
});
