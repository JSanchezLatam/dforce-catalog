import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Only `npm run test:portal-sync` uses this (it creates the two throwaway
 * databases and passes their URLs in). The file is named `*.local.ts`, not
 * `*.test.ts`, so no default run (`npm test`, `npm run test:e2e`) picks it up.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/portal-sync/**/*.local.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@portal/contract": path.resolve(__dirname, "./portal/src/contract.ts"),
    },
  },
});
