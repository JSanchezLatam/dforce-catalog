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
    /**
     * Raised from Vitest's 5000ms default. Issue #54: the suite went red
     * intermittently, a different set of files each time, always ones the
     * change under test never touched.
     *
     * Measured, not guessed. The slowest tests in a normal parallel run are
     * ~2.4s (`UserForm > requires a username`) and ~2.0s
     * (`WorkshopConfigForm > renders and submits every new contact field`) —
     * legitimately, since a jsdom test that opens a base-ui dialog, picks
     * from a dropdown and types into a controlled React form re-renders on
     * every keystroke. Against 5000ms that is barely 2x of headroom, and any
     * second heavy process on the machine spends it.
     *
     * What made it look random is a CASCADE, and it is worth knowing because
     * this timeout makes it rare rather than impossible. A timed-out test is
     * failed by Vitest but its `userEvent.type` promise is NEVER cancelled;
     * the loop keeps dispatching keystrokes, and userEvent sends each one to
     * `document.activeElement` — which by then belongs to the NEXT test. That
     * test then fails on interleaved text it never typed. #54 opened on
     * exactly that evidence: `'lLeurn.-cVoime 9-'`, which de-interleaves into
     * `Lun-Vie9` + `ler.com` — two adjacent tests of one file writing into one
     * field. So one timeout takes a victim, and the victim's message points at
     * innocent code.
     *
     * Reproduce (and re-verify any change to this number) by running the
     * suite against itself — the real-world "GGA is also running" case:
     *   npm test > /tmp/a.txt 2>&1 & npm test > /tmp/b.txt 2>&1; wait
     *
     * How much concurrency it takes depends on how many tests the branch has,
     * which is itself the warning: the margin shrinks as the suite grows.
     * Measured at 5000ms — TWO concurrent suites on a feature branch (948
     * tests) gave 25 timeouts / 26 failures per run; on `main` (928 tests) two
     * were not enough and THREE gave 4-5 timeouts / 5-6 failures. Note the
     * failures exceed the timeouts in every one of those runs: the difference
     * is the cascade taking victims.
     *
     * At 15000ms all of the above are clean — three concurrent suites, 928/928
     * each, zero timeouts.
     *
     * The cost is only that a genuinely hung test takes 15s to report. These
     * were never hung — just slow.
     */
    testTimeout: 15_000,
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
