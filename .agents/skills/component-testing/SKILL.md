---
name: component-testing
description: How to write a React component test in this repo. Trigger: creating or editing a *.test.tsx file, adding coverage for a component, or debugging why a component test does not run in the right Vitest project.
---

# Component testing

`vitest.config.ts` uses `test.projects` (Vitest 4 — `environmentMatchGlobs` was
removed, this is the supported replacement) to split ONE `npm test` run into two
projects.

| Project | Files | Environment | Setup |
|---|---|---|---|
| `node` | everything except `*.test.tsx` | `node` | none |
| `jsdom` | only `*.test.tsx` | `jsdom` | `vitest.setup.ts` |

## Naming convention

**The extension is the router.** Give a component test the `.test.tsx`
extension to send it to the `jsdom` project. Everything else (`.test.ts`) stays
on `node`. A component test named `.test.ts` will run without a DOM and fail in
a confusing way.

## Writing one

`render()` from `@testing-library/react`, inside whatever context the component
needs (commonly `<SidebarProvider>`). Query with `screen` / `within` by role.
Interact with `@testing-library/user-event`.

Full worked example: `src/components/app-sidebar.test.tsx` — collapsible
sidebar groups, covering `aria-expanded`, `aria-controls`, keyboard activation,
and independent group state.

For a page component: `render(await Page({ params }))` works directly in the
existing jsdom project — no harness and no extra dependency needed.

## What `vitest.setup.ts` provides

- jest-dom matchers via `@testing-library/jest-dom/vitest`
- a `window.matchMedia` shim for `use-mobile.ts`
- manual RTL `cleanup()` registered via `afterEach` imported from `"vitest"`

That `cleanup()` is manual on purpose. This repo does not set
`test.globals: true`, and `@testing-library/react`'s built-in auto-cleanup only
registers itself when `afterEach` exists as an ambient global. Without the
manual registration, DOM state leaks between tests.

## Timeouts

`testTimeout` is 15s and the `jsdom` project is capped at `maxWorkers: 2`. Both
were measured, not guessed — the measurements are in `vitest.config.ts` next to
the settings.

If a component test times out, read `AGENTS.md` → Code quality gate: the first
timeout in a file is the real failure, and assertion failures after it in the
same file are collateral.

## Dependencies

`jsdom`, `@testing-library/react`, `@testing-library/user-event`,
`@testing-library/jest-dom` — all already in `devDependencies`.
