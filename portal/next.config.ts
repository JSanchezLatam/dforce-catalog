import type { NextConfig } from "next";
import path from "node:path";

const secure = [
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "no-store" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

const nextConfig: NextConfig = {
  // Pin the tracing root to portal/: the repo root has its own lockfile, and
  // Next would otherwise guess the workspace root from the wrong one.
  outputFileTracingRoot: path.resolve(__dirname),
  // Dev only, same as the workshop app: `next dev` blocks its HMR/dev resources
  // for any origin but localhost, so a phone on the LAN never hydrates `/c`.
  // Vercel runs a build, which has no such restriction.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*"],
  async headers() {
    // Every page and route, so the neutral `/` boot page is covered too. Only the
    // framework's hashed assets are left out: `no-store` would break their caching.
    return [{ source: "/((?!_next/static|_next/image|favicon.ico).*)", headers: secure }];
  },
};

export default nextConfig;
