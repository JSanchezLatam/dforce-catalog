import { describe, expect, it } from "vitest";

import { rateLimited } from "./rate-limit";

const req = (xff?: string) =>
  new Request("http://portal.test/api/c/open", { method: "POST", headers: xff ? { "x-forwarded-for": xff } : {} });

describe("rateLimited", () => {
  it("lets 30 requests through and blocks the 31st inside 60 s", () => {
    const r = () => req("10.0.0.1");
    for (let i = 0; i < 30; i++) expect(rateLimited(r(), 1_000)).toBe(false);
    expect(rateLimited(r(), 1_000)).toBe(true);
    expect(rateLimited(r(), 60_999)).toBe(true);
  });

  it("rolls the window over after 60 s", () => {
    for (let i = 0; i < 31; i++) rateLimited(req("10.0.0.2"), 5_000);
    expect(rateLimited(req("10.0.0.2"), 5_000)).toBe(true);
    expect(rateLimited(req("10.0.0.2"), 65_000)).toBe(false);
  });

  it("keys by the first x-forwarded-for hop only", () => {
    for (let i = 0; i < 30; i++) rateLimited(req("10.0.0.3, 1.1.1.1"), 1_000);
    expect(rateLimited(req("10.0.0.3, 2.2.2.2"), 1_000)).toBe(true);
    expect(rateLimited(req("10.0.0.4, 1.1.1.1"), 1_000)).toBe(false);
  });

  it("shares one bucket when the header is missing", () => {
    for (let i = 0; i < 30; i++) rateLimited(req(), 1_000);
    expect(rateLimited(req(), 1_000)).toBe(true);
  });
});
