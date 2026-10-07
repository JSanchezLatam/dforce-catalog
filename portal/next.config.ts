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
  async headers() {
    return [
      { source: "/c", headers: secure },
      { source: "/api/c/:path*", headers: secure },
    ];
  },
};

export default nextConfig;
