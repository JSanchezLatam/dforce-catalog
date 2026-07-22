import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Self-hosted Docker deployment as a single long-lived Node process
  // (not Vercel/serverless) — see design.md "Technical Approach".
  output: "standalone",
  // Pin the file-tracing root to this project: a stray lockfile in a parent
  // directory (outside this repo) makes Next.js misdetect the workspace
  // root, which would silently break what gets copied into the standalone
  // output.
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
