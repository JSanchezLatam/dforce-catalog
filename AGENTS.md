# Agent Instructions — Dforce Catálogo

Read by coding agents (Claude Code, OpenCode, GGA) working in this repository.
Standing conventions and decisions only — not a session log, not a war-story
archive. Rationale and measurements belong next to the code they explain or in
Engram. Stack/API/DB reference: `STACK.md`. A change's detailed rationale:
`openspec/changes/<name>/design.md`.

## Cross-tool memory and task sharing (Claude Code ↔ OpenCode)

Verified 2026-07-27 — don't re-litigate without re-checking first.

- **Engram is already shared.** Both tools hit the same local server and
  resolve the same project key (`dforce-catalog`), so a `mem_save` from either
  is visible to the other with zero config. If cross-tool recall seems broken,
  the server is down (`curl http://127.0.0.1:7437/health` → `{"status":"ok"}`)
  — do not wire up a bridge, one exists.
- **SDD task state lives in committed files**, not only in Engram. Either tool
  can pick up a change by pointing at its `openspec/changes/<name>/tasks.md`.
- Whether a session *actually* calls `mem_save` depends on its persona. A
  missing memory is more often a session that skipped saving than broken
  plumbing.

## SDD workflow

Substantial changes: `proposal.md` → `spec.md` (delta specs under
`openspec/changes/<name>/specs/<capability>/`) → `design.md` → `tasks.md`.
Completed changes merge into the main specs and get archived. Check for an
`openspec/changes/<name>/` directory before assuming a feature was never
planned.

**Large changes ship as chained PRs**: a draft tracker branch off `main`
accumulates the feature; each work-unit PR targets the previous PR's branch, in
order; the tracker merges to `main` only once every child has landed. Template
for deciding when a change needs this:
`openspec/changes/archive/crm-workshop-management/tasks.md` (Review Workload
Forecast).

## Standing architectural decisions

Each of these has been re-litigated at least once. Don't reopen without new
evidence.

- **Auth**: DB-backed opaque session tokens (`users`/`sessions`,
  `src/modules/auth/session.ts`) — not JWT. No signing-secret class of bug here.
- **Theme**: shadcn stock neutral palette, light and dark in
  `src/app/globals.css`, toggled via `next-themes`. This flipped twice before
  (Kanagawa Dragon, then a violet/gold brand palette) — read the current
  `globals.css` before changing any color.
- **CRM/workshop is built natively**, not by integrating `Hainrixz/auto-crm`
  (SQLite, generic sales-CRM — this app is Postgres and workshop-shaped). See
  `openspec/changes/archive/crm-workshop-management/`.
- **Reminders**: `whatsappOptOut` and `emailOptOut` on `cliente` are two
  independent booleans — legally distinct consent regimes, never collapse them.
  `runReminder` re-checks row status before dispatch (idempotent against
  pg-boss retries), `src/modules/reminders/job.ts`.
- **No real-time stock deduction** anywhere — `producto.stock` is only
  overwritten wholesale by the inventory sync. Adding stock-decrementing logic
  to a new feature is new scope, not a bug fix.
- **Security headers** in `next.config.ts`. CSP is deliberately unconfigured:
  it needs the R2/Interfuerza image hosts allowlisted first, or it silently
  breaks product images app-wide.
- **44x44 minimum hit target on action controls.** The rule is
  `openspec/changes/archive/crm-shell-settings-rbac/design.md:245`, and its
  only waiver there is conditional — the collapsed sidebar rail is
  "desktop-and-pointer-only and never a touch surface". Most surfaces are not:
  this is a workshop app used from tablets. `size="default"` on a `Button` is
  `h-8` = 32px, so an action control needs `min-h-11 min-w-11` on top of it.
  Two standing exceptions: a filter strip whose controls sit against `h-8`
  inputs and read as one control, and `shared/ui/Pagination.tsx`, which is
  still 28px and is its own change. **No test asserts a button height**, so a
  green suite is not evidence here. The rule was invisible in an archived
  design doc and got repealed wholesale on `feat/customers-ui-polish` before
  GGA caught it; it is written here so the next reader finds it.

Writing a component test is a procedure, not a decision — see the
`component-testing` skill.

## Language: Spanish for the user, English for the code

Decided 2026-08-12, final. The split is by AUDIENCE, not by file: a
`"use client"` component holds Spanish strings and English identifiers on the
same line, and that is correct.

- **Spanish** — UI copy, labels, `aria-label`s, validation and error messages,
  empty states, the generated PDF, `scripts/dev.sh` output. Rioplatense, to
  match `Clientes` / `Órdenes de servicio` / `Gestión de usuarios`.
- **English** — identifiers, comments, test names, commit messages, PR
  descriptions, this file, openspec artifacts.

Tests assert the Spanish string. Those are what catch an untranslated screen —
never loosen them to match both languages.

## Addressing the user

Every reply addresses or greets the user as **"thanos"**, in every response and
every session. Conversation text only — never in code, comments, commits, PRs,
or specs. Same audience split as the language rule above.

## Commits

Conventional commits, and **no AI attribution** — no `Co-Authored-By` naming
Claude, no `Claude-Session`, no "Generated with Claude Code".

This rule lived only in prose until 2026-09-04, when an agent was talked out of
it by a runtime directive and four commits shipped carrying it. Prose is advice;
`.githooks/commit-msg` is enforcement. It strips those trailers from the
finished message, so it covers Claude Code, OpenCode, Codex, an IDE, and a plain
`git commit` alike. Human `Co-authored-by` trailers are preserved.

`core.hooksPath` is per-clone local config, so a fresh clone must enable it once:

```
git config core.hooksPath .githooks
```

## Simplicity & scope discipline

Smallest change that solves the actual ask. Before adding code:

1. Does a module in `src/modules/*` already do this? `auth/session.ts` and
   `reminders/job.ts` are the reference patterns for injectable seams and
   idempotent job handling.
2. Does the stdlib, or something already in `package.json`, solve it?
3. Is this the actual scope, or a speculative future need?

**Do not expand scope silently.** A tempting related improvement goes in the
change's `tasks.md` as a follow-up and in the PR description — not into the
current PR. This applies doubly to chained PRs.

One standing exception: Strict TDD is not scaffolding to be trimmed. A change
is not smaller for having skipped its RED test.

## Testing

`npm test` (`vitest run`) runs both projects — `node` (DB-free unit tests) and
`jsdom` (`*.test.tsx` component tests) — in one command, safe to run anywhere.
`src/e2e/**` needs a reachable Postgres (see `README.md`) and is excluded.

**Strict TDD**: RED test first, confirm it fails, then GREEN. For a retrofit
test on shipped code where a real RED isn't possible, verify the test is
meaningful by temporarily breaking the implementation and confirming it fails.

**Known coverage limit — a green run does not mean verified SQL.** Most of
`src/modules/*/service.ts` uses an injected-dependency seam
(`deps?.thing ?? realDbCall`). Every unit test supplies the dep, so the `else`
branch — the one holding the real column names, `WHERE` clauses and casts —
never executes. `vitest.config.ts` points `DATABASE_URL` at a nonexistent
database, so anything reaching a real branch would fail loudly: a fully green
suite therefore *proves* zero real-SQL coverage. Hand-built SQL (e.g.
`applyUserPatchTx`'s dynamic `SET` and `::role` cast) compiles, passes, and can
still be wrong at runtime. Until a Postgres testcontainer exists, smoke-test
those paths against a throwaway database before merging.

**Second known limit — jsdom cannot see a Server Component boundary or a
hydration mismatch.** Two production defects shipped for months under a green
suite and were found only when real data mounted the component: a function
passed from a server component to a `"use client"` one (Next.js refuses and the
page does not render), and a portal behind `typeof document !== "undefined"`
(React's documented cause #1 for a hydration mismatch). Reverting either fix
leaves the suite green — vitest invokes a page as a plain function, so there is
no RSC SERIALIZATION to violate, and `render()` takes the client snapshot
directly rather than a server render plus `hydrateRoot`.

Both were caught by opening a browser and reading the console. **When a change
crosses a Server Component boundary or touches a portal, that is the
verification** — a test cannot be written for it, and a green run is not
evidence. Also note the trigger: `Pagination` returns `null` at `pageCount <=
1`, so one customer in the dev database hid the first defect entirely. A bug
that depends on data VOLUME does not exist until there is data.

## Code quality gate

- **`npm test` and `npx tsc --noEmit` clean before a PR.**

  Reading a red run: timeouts cascade, so the failure count is not the defect
  count. A test that blows `testTimeout` keeps running and its `userEvent.type`
  keystrokes land on the NEXT test's `document.activeElement`, which then fails
  on text it never typed. **The first timeout in a file is the real failure;
  assertion failures after it are collateral.** Fix the timeout, re-run.

  `testTimeout` is 15s and the `jsdom` project is capped at `maxWorkers: 2`.
  Both numbers were measured, and the measurements live in `vitest.config.ts`
  next to the settings — read them there, not here.

- **`npm run lint`**: 0 errors, **14** warnings (verified 2026-09-09; was 15
  until `list-search-filters` WU1 replaced `InventoryFilters`' hand-styled
  `<button>` with the shadcn `Button`, clearing one), all pre-existing. Don't add to them; clearing them is its own change. Re-run
  before trusting that count.

- **Substantial changes go through the gentle-ai review flow**
  (`gentle-ai review status --contract gentle-ai.review-integration/v2 --agent
  <runtime> --next-transition`), which selects lenses by risk and produces a
  receipt. It caught a merge-blocking defect in `user-lifecycle-management` WU3
  that the full suite passed over.

### GGA — run it before opening a PR

```
gga run --pr-mode --diff-only
```

Configured in `.gga` (v2.10.1): provider `claude`, `*.ts,*.tsx,*.js,*.jsx`,
excluding only `*.d.ts`, rules from this file, `TIMEOUT="900"`. No environment
variables needed. `gga run --ci` reviews just the last commit.

- **Run `gga config` first on any new machine.** GGA loads `.gga` via
  `source <(…)`, which is a silent no-op on the bash 3.2 macOS ships — every
  value reverts to its default and GGA reviews every changed file. Fixed here
  with `brew install bash`; a machine without one fails silently.
- **900s is not optional** at this repo's changeset size. An 18-file branch
  timed out mid-response at the 300s default, and a timeout is not a PASS.
- **Tests are deliberately not excluded.** Work units ship as test-only
  commits; excluding `*.test.ts` would mean the reviewer sees nothing at all on
  those. A test asserting the wrong thing is a real defect, and this project
  has shipped one.
- **Never name a branch `*main*`, `*master*` or `*develop*`.**
  `detect_base_branch()` matches with `grep -qw` and `/`/`-` are word
  boundaries, so `feat/main-nav` satisfies the check for `main`; the range then
  breaks, zero files are found, and gga exits 0 having reviewed nothing.
- **There is deliberately no git hook.** A run takes two to four minutes and
  this repo commits in small work units — automating the trigger added
  maintenance, not findings. Every real finding came from a manual run.
- `--pr-mode` auto-detect always resolves to `main`, so a chained branch
  re-reviews every ancestor commit. Pin `PR_BASE_BRANCH` per-branch when it
  matters.

GGA runs *in addition to* the gentle-ai receipt flow above — GGA on commit, RDD
before delivery. Two AI reviews per change is deliberate.
