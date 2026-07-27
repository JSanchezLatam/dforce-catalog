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
  // PR9 — playwright-core's own manifest (`browsers.json`) isn't reachable
  // via static `import`/`require` analysis, so Next's file tracer omits it
  // from `.next/standalone` (confirmed: `node .next/standalone/server.js`
  // crashed at boot with "Cannot find module .../playwright-core/browsers.
  // json" the moment src/instrumentation.ts made `playwright` reachable
  // from the server bundle for the first time — PR7/PR8 never hit this
  // because nothing imported pdf-generation/worker.ts from within Next's
  // build graph until PR9). This is Next's own documented fix for exactly
  // this class of gap (see node_modules/next/dist/docs/.../output.md's
  // "Common include patterns for native/runtime assets" — it lists
  // `sharp`/`aws-crt` as examples of the same problem). The actual Chromium
  // *binary* still comes from the Docker image's `/ms-playwright` cache
  // (Dockerfile's `mcr.microsoft.com/playwright` base, not node_modules) —
  // this only restores playwright-core's own small JS/JSON files.
  outputFileTracingIncludes: {
    "/*": ["node_modules/playwright-core/**/*"],
  },
  // Baseline security headers — this app had none. CSP is deliberately NOT
  // included here: it needs to allowlist the R2/Interfuerza image hosts
  // LazyImage loads from, and getting that wrong silently breaks product
  // images app-wide, so it needs its own scoped follow-up rather than a
  // guessed policy bundled into this pass.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
