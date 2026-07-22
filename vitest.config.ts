import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // `pg.Pool`/env.ts's required() only need SOME value present at import
    // time — unit tests never open a real connection. Real DB access is
    // covered by integration tests once a Postgres testcontainer exists
    // (design.md Testing Strategy).
    env: { DATABASE_URL: "postgres://test:test@localhost:5432/test_placeholder" },
  },
  resolve: {
    // Mirror tsconfig.json's "@/*" path alias (ponytail: no vite-tsconfig-paths
    // dependency needed for a single alias).
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
