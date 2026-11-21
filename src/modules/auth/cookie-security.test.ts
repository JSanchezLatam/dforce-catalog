import { describe, expect, it } from "vitest";

import { isHttpsRequest } from "./cookie-security";

describe("isHttpsRequest", () => {
  it("is false on the plain-HTTP LAN, where the header says http", () => {
    expect(isHttpsRequest(new Headers({ "x-forwarded-proto": "http" }))).toBe(false);
  });

  it("is false with no header at all", () => {
    expect(isHttpsRequest(new Headers())).toBe(false);
  });

  it("is true when the trusted header says https", () => {
    expect(isHttpsRequest(new Headers({ "x-forwarded-proto": "https" }))).toBe(true);
  });

  it("reads only the first value, trimmed and in any case", () => {
    expect(isHttpsRequest(new Headers({ "x-forwarded-proto": " HTTPS , http" }))).toBe(true);
    expect(isHttpsRequest(new Headers({ "x-forwarded-proto": "http, https" }))).toBe(false);
  });
});
