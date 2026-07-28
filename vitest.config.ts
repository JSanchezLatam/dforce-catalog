import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

// `pg.Pool`/env.ts's required() only need SOME value present at import
// time — unit tests never open a real connection. Real DB access is
// covered by integration tests once a Postgres testcontainer exists
// (design.md Testing Strategy).
const DATABASE_URL = "postgres://test:test@localhost:5432/test_placeholder";

export default defineConfig({
  test: {
    env: { DATABASE_URL },
    // src/e2e/** needs a REAL reachable Postgres (see vitest.e2e.config.ts +
    // README) — excluded here so plain `npm run test` stays fast/infra-free.
    exclude: [...configDefaults.exclude, "src/e2e/**"],
    // Two projects, one `npm test` run (`vitest run`) — see AGENTS.md's
    // Testing section for the full writeup.
    //
    // Vitest 4 removed `environmentMatchGlobs` (no references left in the
    // installed `vitest@4.1.10` types); `test.projects` is the supported
    // replacement for routing a subset of files to a different environment
    // (confirmed against `node_modules/vitest/dist/chunks/reporters.d.*.d.ts`
    // — `TestProjectConfiguration`/`TestProjectInlineConfiguration` support
    // `extends: true` to inherit this root config plus per-project
    // overrides). Each project below is an inline object, not a separate
    // workspace file.
    projects: [
      {
        // All 449 pre-existing tests: `environment: "node"`, unchanged.
        extends: true,
        test: {
          name: "node",
          environment: "node",
          exclude: [...configDefaults.exclude, "src/e2e/**", "**/*.test.tsx"],
        },
      },
      {
        // Component tests only — naming convention: `*.test.tsx` (see
        // AGENTS.md). Everything else keeps running under "node" above.
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["**/*.test.tsx"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
  resolve: {
    // Mirror tsconfig.json's "@/*" path alias (ponytail: no vite-tsconfig-paths
    // dependency needed for a single alias).
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
