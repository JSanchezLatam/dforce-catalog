import { defineConfig } from "vitest/config";
import path from "node:path";

// Needs a REAL Postgres: DATABASE_URL comes from the environment (a throwaway
// `dforce_portal_test`, never `dforce_portal`).
export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
