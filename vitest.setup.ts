/**
 * Setup for the "jsdom" Vitest project only (see vitest.config.ts's
 * `test.projects`) — never loaded by the "node" project, so the 449
 * DB-free unit tests keep running exactly as before.
 *
 * This repo does NOT use `test.globals: true` (tests explicitly import
 * `describe`/`it`/`expect`/`afterEach` from "vitest" — see AGENTS.md's
 * Testing section). Because of that, `@testing-library/react`'s advertised
 * "automatic cleanup" does NOT kick in on its own: its main entry point
 * only registers an `afterEach` hook if `afterEach` already exists as an
 * AMBIENT GLOBAL (see `@testing-library/react/dist/index.js`), which is
 * only true when `test.globals: true` is set. Since we deliberately keep
 * globals off repo-wide, we register cleanup ourselves below instead of
 * flipping that project-wide switch just for this.
 */
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
});

// jsdom does not implement `window.matchMedia` (used by `src/hooks/use-mobile.ts`
// via shadcn's sidebar). This is a standard RTL/jsdom shim, not a mock of any
// app behavior — every listener is a no-op since we don't test breakpoint
// changes here.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
