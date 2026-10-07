import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the tracing root to portal/: the repo root has its own lockfile, and
  // Next would otherwise guess the workspace root from the wrong one.
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
