import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { MAX_SKEW_SECONDS, SIGNATURE_HEADER, TIMESTAMP_HEADER, sign, verify } from "./contract";

const SECRET = "test-secret";
const BODY = JSON.stringify({ kind: "delete", clienteId: "c1", version: 3 });
const NOW = 1_800_000_000;

const headersAt = (ts: number, body = BODY, secret = SECRET) => new Headers(sign(body, secret, ts));

describe("portal wire contract", () => {
  it("round-trips a signed body", () => {
    expect(verify(BODY, headersAt(NOW), SECRET, NOW)).toBe(true);
  });

  it("emits the documented header names", () => {
    const h = sign(BODY, SECRET, NOW);
    expect(h[TIMESTAMP_HEADER]).toBe(String(NOW));
    expect(h[SIGNATURE_HEADER]).toMatch(/^[0-9a-f]{64}$/);
    expect([TIMESTAMP_HEADER, SIGNATURE_HEADER]).toEqual(["x-portal-timestamp", "x-portal-signature"]);
  });

  it("rejects a body tampered by one byte", () => {
    expect(verify(BODY.replace("c1", "c2"), headersAt(NOW), SECRET, NOW)).toBe(false);
  });

  it("accepts skew of exactly +/-300 s", () => {
    expect(MAX_SKEW_SECONDS).toBe(300);
    expect(verify(BODY, headersAt(NOW - 300), SECRET, NOW)).toBe(true);
    expect(verify(BODY, headersAt(NOW + 300), SECRET, NOW)).toBe(true);
  });

  it("rejects skew of +/-301 s", () => {
    expect(verify(BODY, headersAt(NOW - 301), SECRET, NOW)).toBe(false);
    expect(verify(BODY, headersAt(NOW + 301), SECRET, NOW)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(verify(BODY, headersAt(NOW), "other-secret", NOW)).toBe(false);
  });

  it("returns false, without throwing, on a signature of the wrong length", () => {
    const h = headersAt(NOW);
    h.set(SIGNATURE_HEADER, "abcd");
    expect(() => verify(BODY, h, SECRET, NOW)).not.toThrow();
    expect(verify(BODY, h, SECRET, NOW)).toBe(false);
  });

  it("rejects a missing header", () => {
    const noSig = headersAt(NOW);
    noSig.delete(SIGNATURE_HEADER);
    const noTs = headersAt(NOW);
    noTs.delete(TIMESTAMP_HEADER);
    expect(verify(BODY, noSig, SECRET, NOW)).toBe(false);
    expect(verify(BODY, noTs, SECRET, NOW)).toBe(false);
  });

  it("rejects a non-numeric timestamp", () => {
    const h = headersAt(NOW);
    h.set(TIMESTAMP_HEADER, "soon");
    expect(verify(BODY, h, SECRET, NOW)).toBe(false);
  });

  it("imports nothing but node:crypto (the workshop and Vercel both load this file alone)", () => {
    const source = readFileSync(path.join(__dirname, "contract.ts"), "utf8");
    const specifiers = [...source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(specifiers).toEqual(["node:crypto"]);
  });
});
