import http from "node:http";

import { describe, expect, it, vi } from "vitest";

import { installTrustedClientAddress, trustedForwardedFor, trustedForwardedProto } from "./trusted-client-address";

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

describe("trustedForwardedProto", () => {
  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])("keeps the header from a local proxy at %s", (address) => {
    expect(trustedForwardedProto(address, "https", false)).toBe("https");
  });

  it("replaces a LAN client's forged https with the plain http it connected over", () => {
    expect(trustedForwardedProto("192.168.1.23", "https", false)).toBe("http");
  });

  it("says https for a connection that is itself encrypted, whatever the client sent", () => {
    expect(trustedForwardedProto("192.168.1.23", "http", true)).toBe("https");
  });

  it("falls back to the connection's own protocol when a local proxy sent no header", () => {
    expect(trustedForwardedProto("127.0.0.1", undefined, false)).toBe("http");
  });

  it("says http when the connection address is unknown", () => {
    expect(trustedForwardedProto(undefined, "https", false)).toBe("http");
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
    const request = {
      headers: { "x-forwarded-for": "10.0.0.9", "x-forwarded-proto": "https" },
      socket: { remoteAddress: "192.168.1.23" },
    };

    server.emit("request", request, {});

    expect(listener).toHaveBeenCalledOnce();
    expect(request.headers["x-forwarded-for"]).toBe("192.168.1.23");
    expect(request.headers["x-forwarded-proto"]).toBe("http");
  });

  it("keeps a local proxy's https, so the tunnel's requests read as https", () => {
    installTrustedClientAddress();
    const server = http.createServer();
    const request = {
      headers: { "x-forwarded-for": "181.197.1.1", "x-forwarded-proto": "https" },
      socket: { remoteAddress: "127.0.0.1" },
    };

    server.emit("request", request, {});

    expect(request.headers).toEqual({ "x-forwarded-for": "181.197.1.1", "x-forwarded-proto": "https" });
  });
});
