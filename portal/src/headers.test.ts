import { describe, expect, it } from "vitest";

import robots from "../app/robots";
import nextConfig from "../next.config";

const headersFor = async (source: string) => {
  const rules = await nextConfig.headers!();
  const rule = rules.find((r) => r.source === source);
  return Object.fromEntries((rule?.headers ?? []).map((h) => [h.key, h.value]));
};

describe("portal security headers", () => {
  // One rule for every page and route (the neutral `/` boot page included), minus the
  // framework's own hashed assets, whose immutable caching `no-store` would break.
  const ALL = "/((?!_next/static|_next/image|favicon.ico).*)";

  it("carries the full set on one catch-all rule", async () => {
    const rules = await nextConfig.headers!();
    expect(rules.map((r) => r.source)).toEqual([ALL]);
    expect(await headersFor(ALL)).toEqual({
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it.each(["/", "/c", "/api/c/open", "/api/ingest", "/anything/else"])("%s is covered", (path) => {
    expect(new RegExp(`^${ALL}$`).test(path)).toBe(true);
  });

  it.each(["/_next/static/chunks/a.js", "/_next/image", "/favicon.ico"])("%s is left to the framework", (path) => {
    expect(new RegExp(`^${ALL}$`).test(path)).toBe(false);
  });

  it("robots.txt disallows everything", () => {
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});
