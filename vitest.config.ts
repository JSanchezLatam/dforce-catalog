import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    // Mirror tsconfig.json's "@/*" path alias (ponytail: no vite-tsconfig-paths
    // dependency needed for a single alias).
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
