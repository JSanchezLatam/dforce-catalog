# Agent Instructions — Dforce Catálogo

This file is read by coding agents (OpenCode, Claude Code, and others) working
in this repository. Keep it current — it should describe standing
conventions and decisions, not a session log. For stack/API/DB reference see
`STACK.md`. For a specific change's detailed rationale, read that change's
`openspec/changes/<name>/design.md` — do not assume this file has the full
story.

## Cross-tool memory and task sharing (Claude Code ↔ OpenCode)

This project is worked on from both Claude Code and OpenCode on the same
machine. Two things carry state between them automatically — verified
2026-07-27, don't re-litigate this without checking again first:

1. **Engram memory is ALREADY shared, not tool-specific.** Both tools talk to
   the same local `engram serve` process (a Homebrew-installed Go binary,
   HTTP on `127.0.0.1:7437`, SQLite-backed) — Claude Code via its Engram MCP
   plugin, OpenCode via `~/.config/opencode/plugins/engram.ts` (a global
   plugin, loaded for every OpenCode project automatically — it does NOT
   need to be listed in this repo's `opencode.json`). Both resolve the same
   project key (`dforce-catalog`, from `git remote get-url origin`), so a
   `mem_save` from either tool is visible to the other with zero extra
   config. If cross-tool recall ever seems to fail, the fix is almost
   certainly "the engram server isn't running" (`curl
   http://127.0.0.1:7437/health` should return `{"status":"ok"}`), not
   "wire up a bridge" — the bridge already exists.
2. **SDD task/plan state lives in committed files**, not just in Engram:
   `openspec/changes/<name>/{proposal,spec,design,tasks}.md`. OpenCode has a
   mirrored SDD skill/command set installed
   (`~/.config/opencode/skills/sdd-*`, `~/.config/opencode/commands/sdd-*.md`)
   that reads/writes these same files, so a change proposed/planned in one
   tool can be picked up and implemented in the other by pointing it at the
   change's `tasks.md` checklist.

**What this does NOT guarantee**: whether a given agent persona *actually
calls* `mem_save`/`mem_search` proactively depends on that session's own
system prompt including the memory instructions (both tools inject this by
default, but a custom persona/plugin — e.g. ponytail's "lazy" mode — can
still choose not to be proactive about it). If a past session's decisions
don't show up in memory, check whether that session was likely to have
skipped saving, not just assume the plumbing is broken.

## SDD workflow

Substantial changes go through Spec-Driven Development: `proposal.md` →
`spec.md` (delta specs, `openspec/changes/<name>/specs/<capability>/spec.md`)
→ `design.md` → `tasks.md`, all under `openspec/changes/<name>/`. Completed
changes get merged into main specs and archived (see `openspec/` for
in-progress and archived changes). Some changes were run with a
Claude-Code-specific hybrid backend (Engram + files); others (this session's
work) are file-only — check for an `openspec/changes/<name>/` directory
before assuming a feature was never planned.

**Large changes are delivered as chained PRs** (feature-branch-chain
strategy): a draft tracker branch/PR off `main` accumulates the full
feature; each work-unit PR targets the previous PR's branch, in order; only
the tracker merges to `main` once every child PR has landed. See
`openspec/changes/archive/crm-workshop-management/tasks.md`'s Review Workload
Forecast for the template this repo uses to decide when a change needs this.

## Standing architectural decisions

- **Auth**: DB-backed opaque session tokens (`users`/`sessions` tables,
  `src/modules/auth/session.ts`) — not JWT. There is no signing-secret
  fallback class of bug to worry about here.
- **Theme**: shadcn's stock neutral palette, both light and dark populated in
  `src/app/globals.css`, toggled at runtime via `next-themes`
  (`src/components/theme-provider.tsx`, `src/modules/layout/ThemeToggle.tsx`
  in the sidebar user menu). This has flipped direction twice before (a
  custom "Kanagawa Dragon" theme, then a custom violet/gold brand palette,
  now shadcn stock) — don't assume any specific color value is permanent;
  read the current `globals.css` before changing it.
- **CRM/workshop features are built natively**, not by integrating the
  separate `github.com/Hainrixz/auto-crm` repo — that project runs on SQLite
  (this app is Postgres) and is a generic sales-CRM, not workshop-shaped.
  `openspec/changes/archive/crm-workshop-management/` documents the customer
  (`cliente`), service-order (`orden_servicio`), and reminder (`reminder`,
  pg-boss `sendAfter` + Resend/Kapso) modules built instead.
- **Reminders**: WhatsApp and email opt-out are two independent booleans on
  `cliente` (`whatsappOptOut`/`emailOptOut`) — they are legally distinct
  consent regimes, never collapse them into one flag. `runReminder` re-checks
  the row's status before dispatching to a provider (idempotent against
  pg-boss retries) — see `src/modules/reminders/job.ts`.
- **No real-time stock deduction** anywhere in this app — `producto.stock` is
  only ever overwritten wholesale by the weekly/manual inventory sync. Don't
  add stock-decrementing logic to a new feature (e.g. service orders) unless
  explicitly asked; it would be new scope, not a bug fix.
- **Component testing** — `vitest.config.ts` uses `test.projects` (Vitest 4;
  `environmentMatchGlobs` was removed, this is the supported replacement) to
  split ONE `npm test` run into two projects:
  - `node` — everything except `*.test.tsx`. Same DB-free unit tests as
    always, unchanged `environment: "node"`.
  - `jsdom` — only `*.test.tsx` files, `environment: "jsdom"`, loads
    `vitest.setup.ts` (jest-dom matchers via `@testing-library/jest-dom/vitest`,
    a `window.matchMedia` shim for `use-mobile.ts`, and manual RTL `cleanup()`
    registered via `afterEach` from `"vitest"` — NOT automatic, because this
    repo does not set `test.globals: true`; `@testing-library/react`'s
    built-in auto-cleanup only registers when `afterEach` exists as an
    ambient global).
  - **Naming convention**: give a component test the `.test.tsx` extension
    (not `.test.ts`) to route it to the `jsdom` project. Everything else
    (`.test.ts`) stays on `node`.
  - To write one: `render()` from `@testing-library/react` inside a
    `<SidebarProvider>` (or whatever context the component needs), query
    with `screen`/`within` by role, interact with `@testing-library/user-event`.
    See `src/components/app-sidebar.test.tsx` for a full example (collapsible
    sidebar groups — aria-expanded, aria-controls, keyboard activation,
    independent group state).
  - Deps: `jsdom`, `@testing-library/react`, `@testing-library/user-event`,
    `@testing-library/jest-dom` (devDependencies).
- **Security headers** are set in `next.config.ts`. CSP is deliberately not
  configured yet — it needs the actual R2/Interfuerza image hosts allowlisted
  first, or it silently breaks product images app-wide.

## Simplicity & scope discipline

This repo enforces "smallest change that solves the actual ask" as a standing
rule, not a style preference — see the "no real-time stock deduction" decision
above for the canonical example.

Before adding code, check in this order:

1. Does an existing module already do this? Look in `src/modules/*` first —
   `auth/session.ts` and `reminders/job.ts` are the reference patterns for
   injectable seams and idempotent job handling respectively.
2. Does the stdlib, or a dependency already in `package.json`, solve it? Read
   `package.json` before adding anything new.
3. Is this solving the actual change scope, or a speculative future need? If
   speculative — skip it and note it in the PR description instead of
   building it.

**Do not expand scope silently.** If implementing a change surfaces a tempting
related improvement ("while I'm here, let's also refactor X"), it goes in the
change's `tasks.md` as a follow-up and in the PR description, not into the
current PR. This applies doubly to chained-PR features (see
"feature-branch-chain strategy" above) — each child PR stays scoped to its own
`tasks.md` entry.

This is tool-agnostic: it describes what the repo expects, not a setting in
any particular agent harness. Note the one standing exception — Strict TDD
(below) is not scaffolding to be trimmed. A change is not smaller for having
skipped its RED test.

## Testing

`npm test` (`vitest run`) — runs BOTH the `node` project (DB-free unit
tests) and the `jsdom` project (component tests, see "Component testing"
above) in one command; safe to run anywhere. `src/e2e/**` needs a real
reachable Postgres (see `README.md`) and is excluded from the default run.
Strict TDD is the norm in this repo: RED test first (confirm it fails), then
GREEN implementation — for a retrofit test on already-shipped code where a
real RED phase isn't possible, verify the test is meaningful instead by
temporarily breaking the implementation and confirming the test fails, then
reverting.

**Known coverage limit — do not mistake a green run for verified SQL.** Most
of `src/modules/*/service.ts` uses an injected-dependency seam
(`deps?.thing ?? realDbCall`). Every unit test supplies the dep, so the
`else` branch — the one holding the actual column names, `WHERE` clauses and
casts — never executes. `vitest.config.ts` points `DATABASE_URL` at a
nonexistent database, so any test that did reach a real branch would fail
loudly; a fully green suite therefore *proves* zero real-SQL coverage. Hand-
built SQL (e.g. `applyUserPatchTx`'s dynamic `SET` and its `::role` enum
cast) is the risky case: it compiles, the suite passes, and it can still be
wrong at runtime. Until a Postgres testcontainer exists, verify those paths
with a live smoke test against a throwaway database before merging.

## Code quality gate

What actually gates work:

- `npm test` and `npx tsc --noEmit` must be clean before a PR.
- Substantial changes go through the gentle-ai review flow
  (`gentle-ai review status --contract gentle-ai.review-integration/v2
  --agent <runtime> --next-transition`), which selects lenses by risk and
  produces a receipt. It found a merge-blocking defect in
  `user-lifecycle-management` WU3 that the full test suite passed over.
- `npm run lint` currently reports 5 pre-existing errors (`use-mobile`,
  `CatalogBuilderForm` ×2, `TreeSelect`, `ThemeToggle` — all
  `react-hooks/set-state-in-effect`). Don't add to them; fixing them is its
  own change.

### GGA — the pre-commit reviewer

Configured in `.gga` at the repo root (Gentleman Guardian Angel v2.10.1):

| Setting | Value |
|---|---|
| `PROVIDER` | `claude` |
| `FILE_PATTERNS` | `*.ts,*.tsx,*.js,*.jsx` |
| `EXCLUDE_PATTERNS` | `*.d.ts` only |
| `RULES_FILE` | this file |
| `STRICT_MODE` | `true` |

**Tests are deliberately NOT excluded.** This repo runs strict TDD and whole
work units ship as test-only commits — excluding `*.test.ts` would mean the
reviewer sees nothing at all on those. A test asserting the wrong thing is a
real defect, and this project has already shipped one.

GGA reads THIS file as its rulebook, so a rule written here is a rule it
enforces. It reviews staged files on commit; `gga run --ci` reviews the last
commit and `gga run --pr-mode` the whole branch.

**Known defect (v2.10.1):** `gga` does not read `PROVIDER` from `.gga` or from
`~/.config/gga/config` — `gga config` reports "Not configured" even when both
files set it. The `GGA_PROVIDER=claude` environment variable does work. Until
that is fixed upstream, the variable must be set for the reviewer to run at
all.

This runs *in addition to* the gentle-ai receipt flow above — GGA on commit,
RDD before delivery. Two AI reviews per change is deliberate, not an accident
of configuration.
