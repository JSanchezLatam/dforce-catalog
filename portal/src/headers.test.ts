import { describe, expect, it } from "vitest";

import robots from "../app/robots";
import nextConfig from "../next.config";

const headersFor = async (source: string) => {
  const rules = await nextConfig.headers!();
  const rule = rules.find((r) => r.source === source);
  return Object.fromEntries((rule?.headers ?? []).map((h) => [h.key, h.value]));
};

describe("portal security headers", () => {
  it.each(["/c", "/api/c/:path*"])("%s carries the full set", async (source) => {
    expect(await headersFor(source)).toEqual({
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it("robots.txt disallows everything", () => {
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});
