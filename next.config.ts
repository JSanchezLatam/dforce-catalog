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
  // `next dev` serves its internal resources (`/_next/*`, `/__nextjs_font/*`,
  // the HMR websocket) ONLY to the origin it was started with — `localhost` by
  // default — and answers anything else with a bare 403 `Unauthorized`
  // (`next/dist/server/lib/router-utils/block-cross-site-dev.js`). Reaching a
  // dev server at its LAN address therefore loads the page and then fails to
  // hydrate, which does not look like a permissions problem at all: it looks
  // like a form whose submit button never enables, because the inputs' React
  // state stays empty when `onChange` never attaches.
  //
  // The private ranges rather than one address, because DHCP moves it and the
  // workshop's router may not hand out `192.168.0.x`. Each `*` matches exactly
  // one octet and the part count must match, so these cover any private LAN and
  // nothing public — verified against Next's own matcher, including that
  // `8.8.8.8` is refused.
  //
  // DEV ONLY — `next dev` is the sole reader of this. The workshop runs
  // `next start` on a build, which has no HMR socket and no such restriction,
  // so this changes nothing about what ships.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*"],

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
