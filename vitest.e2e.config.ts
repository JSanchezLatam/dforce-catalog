import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Separate from vitest.config.ts (which pins a fake `DATABASE_URL` — unit
 * tests never open a real connection). This suite needs a REAL reachable
 * Postgres (real Drizzle queries, real pg-boss job processing, a real
 * Playwright Chromium render) — see README's "Running the E2E test".
 * `DATABASE_URL` comes from whatever the environment already has set; this
 * config does not override it, unlike vitest.config.ts.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/e2e/**/*.e2e.test.ts"],
    testTimeout: 60_000, // real Chromium render + real pg-boss job polling
    hookTimeout: 60_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
