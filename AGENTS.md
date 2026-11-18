# Agent Instructions — Dforce Catálogo

Read by coding agents (Claude Code, OpenCode, GGA) working in this repository.
Standing conventions and decisions only — not a session log, not a war-story
archive. Rationale and measurements belong next to the code they explain or in
Engram. Stack/API/DB reference: `STACK.md`. A feature's specs, tasks and
log: `odd/tasks/<feature>.md`.

## Cross-tool memory and task sharing (Claude Code ↔ OpenCode)

Verified 2026-07-27 — don't re-litigate without re-checking first.

- **Engram is already shared.** Both tools hit the same local server and
  resolve the same project key (`dforce-catalog`), so a `mem_save` from either
  is visible to the other with zero config. If cross-tool recall seems broken,
  the server is down (`curl http://127.0.0.1:7437/health` → `{"status":"ok"}`)
  — do not wire up a bridge, one exists.
- **Feature task state lives in committed files**, not only in Engram. Either
  tool can pick up a feature by pointing at its `odd/tasks/<feature>.md`; the
  Engram copy under topic `odd/<feature>/tasks` is the recovery mirror.
- Whether a session *actually* calls `mem_save` depends on its persona. A
  missing memory is more often a session that skipped saving than broken
  plumbing.

## Workflow: ODD (Organic Driven Development)

Decided by the owner 2026-11-16, replacing SDD. The protocol itself ships with
gentle-ai (4.4.0+); this section only records how it maps onto this repo.

- **Small work** (understood, no high-risk item, resumable from `git diff`):
  done inline, no task document.
- **Large work** gets ONE document, `odd/tasks/<feature>.md`: a short header,
  `## Specs` (`S1..Sn`, quoting the owner's words verbatim — never
  summarized), `## Tasks` (ID, linked `S#`, route, commit), `## Log` (`L1` is
  the original request verbatim). It is created when implementation is
  authorized, not while planning, and mirrored to Engram.
- **Writing is inline by default.** A subagent writer needs a named reason:
  parallel units with disjoint files, or the long-session backstop.
- **Mockup first still applies** (see Standing architectural decisions): the
  mockup is approved before any UI task in the document starts.
- **Legacy SDD**: `openspec/specs/` stays as the reference spec baseline, and
  `openspec/changes/archive/` as history. Do not open new `openspec/changes/`.

**Large changes ship as chained PRs**: a draft tracker branch off `main`
accumulates the feature; each work-unit PR (~400 authored lines) targets the
previous PR's branch, in order; the tracker merges to `main` only once every
child has landed.

### Feature lifecycle and stop points

Decided by the owner 2026-11-17.

1. **Grill** — one question at a time until no business decision is open.
2. **Mockup** — approved by the owner before any UI is built.
3. **Feature document** — `odd/tasks/<feature>.md`, created on the go-ahead.
4. **Work units** — ~400 lines each, RED test first, chained PRs.
5. **Per-PR checks** — tests, `tsc`, lint, GGA; the security review below
   when it applies; browser verification at the LAN IP, never localhost.
6. **Milestones** — full security audit and k6 load test (see below).

**The agent stops and waits for the owner only at**: mockup approval;
business decisions that surface mid-way; and anything touching production
(deploy, migrations on the real database, milestone audits). Everything else —
merging PRs whose checks passed included — proceeds autonomously and is
reported.

### Security review

- **Per change**: a change touching auth, permissions, credentials, money or
  internet exposure is flagged in its feature document, and the
  `security-audit` skill reviews it in guidance mode before the PR.
- **Per milestone**: a full `security-audit` before the app is opened to the
  internet, and again before billing goes to production.
- Deliberately not a blocking hook on every commit — see GGA below for why
  automated triggers were dropped here before.

### Performance: k6

`k6` (installed on the dev Mac, `brew install k6`) runs:

- **Smoke test** — a few virtual users through login and the main screens,
  before every production deploy.
- **Load test** — once per milestone (internet opening, billing go-live).
- **Never against the workshop PC during working hours**: it is the app server
  and the database at once. Run against a copy, or out of hours.

### Frontend: Modern Web Guidance

Frontend work (HTML, CSS, client-side JS) consults the `modern-web-guidance`
skill (GoogleChrome/modern-web-guidance) before writing. Its guidance yields
to one rule of this repo: while the app is served over plain HTTP, no
secure-context-only API ships without a working fallback (see the deployment
decision and the third known testing limit).

### Lessons every writer carries

Whoever writes — inline or a delegated worker — applies these. Each one shipped
a defect before it was written down. A delegated writer's prompt must repeat
the ones that bite on its task, because a subagent does not inherit them.

- **Mutation-verify every fix** — revert it, confirm the test goes red BY NAME.
  A test that passes with the fix reverted is a placebo: repair it or delete it.
- **Never write a claim you have not checked**, and that includes types. A
  `count: number` over a string wire is a lying comment moved into the type
  system.
- **A mock more convenient than reality tests the mock, not the code.** Fixture
  shapes must match the wire; `await response.json()` makes every declared type
  a claim.
- **The injected-seam limit**: a green suite proves zero real-SQL coverage, so
  anything whose value is a `WHERE`, an `UPDATE` or a constraint needs an e2e
  row.

## Standing architectural decisions

Each of these has been re-litigated at least once. Don't reopen without new
evidence.

- **Auth**: DB-backed opaque session tokens (`users`/`sessions`,
  `src/modules/auth/session.ts`) — not JWT. No signing-secret class of bug here.
- **Theme**: the support area's palette Opción B across the whole app, decided
  by the owner 2026-11-18: graphite ground, light grey text, workshop red
  `#dc2626` as primary. Dark by default, with a derived light theme, both in
  `src/app/globals.css`, toggled via `next-themes`; `globals-theme.test.ts` pins
  the values and contrast. Red is 3.8:1 on the dark ground, so it never carries
  small text: links use `link-accent` (text colour, red underline). Shadows only
  on the login screens. This flipped three times before (Kanagawa Dragon, a
  violet/gold brand palette, shadcn stock neutral) — read the current
  `globals.css` before changing any color.
- **CRM/workshop is built natively**, not by integrating `Hainrixz/auto-crm`
  (SQLite, generic sales-CRM — this app is Postgres and workshop-shaped). See
  `openspec/changes/archive/crm-workshop-management/`.
- **Architecture: modular monolith, hexagonal-lite inside each module.**
  Decided by the owner 2026-11-17. One app, one Postgres, split into
  `src/modules/<domain>/` named after the business (screaming architecture).
  - **Boundaries**: a module is used by others only through its public
    `index.ts`, and never reads or writes another module's tables. New modules
    own their schema in their own file under `src/shared/db/`.
  - **Inside a module**: *domain* — pure functions holding the business rules
    (`edit-policy.ts`, `transitions.ts` are the models), unit-tested with no
    database; *service* — one use case per function, wrapping its writes in
    one transaction; *adapters* — the database and every external system
    (Interfuerza, the e-invoicing PAC, Telegram, R2) behind an injected
    interface, the `deps?.x ?? real` seam this repo already uses.
  - **Applies to new modules.** Existing modules are brought in line only when
    a change already touches them; a refactor for its own sake is new scope.
  - **Not adopted**: full DDD, CQRS, microservices, full event sourcing —
    ceremony with no payoff at a single workshop's scale.
- **Tenancy: one install per client, ready for multi-tenant.** Decided by the
  owner 2026-11-17: the product will be offered to other similar businesses,
  not only this workshop. Each client gets its own app and database (today's
  model). New data carries the hierarchy **empresa → sucursal → caja** from
  day one, each seeded with one row per install, so a later move to one shared
  multi-tenant platform activates an existing concept instead of retrofitting
  one. Anything specific to one client (Interfuerza, branding, business data,
  PAC credentials) is per-install configuration, never hardcoded.
- **Money and stock rules** (billing, cash, receivables, payables, inventory).
  Decided by the owner 2026-11-17.
  - **Append-only movements.** Stock, cash, receivables and payables are rows
    of movements; a balance is derived from them. A correction is a new
    reversing movement with who, when and why — never an `UPDATE` or `DELETE`
    of a past movement.
  - **Money is integer cents.** Never a JS float; a percentage applied to an
    amount rounds once, at a named step, with a test pinning the rounding.
  - **One operation, one transaction.** Invoicing writes its stock, cash and
    receivable movements in one database transaction: all or nothing. Invoice
    numbers are gapless, so they are not a Postgres `SEQUENCE` (which skips on
    rollback); the exact rule waits on the e-invoicing PAC's documentation.
- **Reminders**: `whatsappOptOut` and `emailOptOut` on `cliente` are two
  independent booleans — legally distinct consent regimes, never collapse them.
  `runReminder` re-checks row status before dispatch (idempotent against
  pg-boss retries), `src/modules/reminders/job.ts`.
- **No real-time stock deduction** anywhere — `producto.stock` is only
  overwritten wholesale by the inventory sync. Adding stock-decrementing logic
  to a new feature is new scope, not a bug fix.
- **The deployment target is plain HTTP over a LAN, and that is not going to
  change.** The app runs on one machine in the workshop and everybody else
  opens it at `http://192.168.x.x:3000` from their own. There is no TLS and no
  domain, so **the browser is in an INSECURE CONTEXT for every user except
  whoever is sitting at the server**. Build for that: no API that requires a
  secure context (`crypto.randomUUID`, `crypto.subtle`, the clipboard, camera,
  geolocation, service workers) without a fallback that works without it — see
  the third known testing limit under Testing for the one that already shipped.
  It also means several people are looking at the same data from different
  machines at once, so a view that only updates the tab that saved is stale for
  everyone else by design; `src/hooks/usePollWhileActive.ts` is this repo's
  answer where that matters.
- **Every mutation tells the operator it happened.** Decided 2026-09-13, and it
  applies to work from here on, not only to what already exists. A create, an
  edit, a deactivation, a bulk action: on success, `useToast()`'s
  `addToast("success", …)` beside the `router.refresh()` that is already there.
  The toast system is `src/shared/ui/Toast*.tsx`, mounted in `app/layout.tsx` —
  it is hand-rolled and it already solved the hydration-portal trap, so do not
  replace it with sonner or Base UI's toast. Copy `OrderStatusControls.tsx`.
  Two rules its comment records and that cost real defects: the toast goes
  **above** `router.refresh()` and both sit **below** the `try/catch`, because a
  refresh that throws must not retract the only confirmation of a mutation the
  server already accepted; and a bulk count reports the rows that actually
  APPLIED, never `ids.length`, or the message contradicts the failure panel
  beside it. Copy is Spanish, subject first, verb in the past, no exclamation
  marks, and the singular when the count is one — `1 cliente desactivado`, not
  `1 clientes`. Form errors stay inline where the operator is already looking;
  a toast there says the same thing twice.
- **`portal/` is a separate Next app, with its own install and gate commands**
  (`cd portal && npm test && npx tsc --noEmit && npm run lint`). Root
  `tsc`/`vitest`/`eslint` exclude it; the one shared file is
  `portal/src/contract.ts`, imported as `@portal/contract`. `npm run test:portal-sync` (root) runs the
  workshop job against the portal's handlers on two throwaway databases; it is in
  no default run.
- **Security headers** in `next.config.ts`. CSP is deliberately unconfigured:
  it needs the R2/Interfuerza image hosts allowlisted first, or it silently
  breaks product images app-wide.
- **44x44 minimum hit target on action controls.** The rule is
  `openspec/changes/archive/crm-shell-settings-rbac/design.md:245`, and its
  only waiver there is conditional — the collapsed sidebar rail is
  "desktop-and-pointer-only and never a touch surface". Most surfaces are not:
  this is a workshop app used from tablets. `size="default"` on a `Button` is
  `h-8` = 32px, so an action control needs `min-h-11 min-w-11` on top of it —
  or nothing, for `Button` `default`/`sm`, `Input`, `SelectTrigger`, the
  sidebar rows, the checkbox and `shared/ui/Pagination.tsx`, which carry
  `pointer-coarse:` classes and rise to 44px on touch by themselves.
  One standing exception, for fine pointers only: a filter strip whose controls
  sit against `h-8` inputs and read as one control. On touch the inputs and
  buttons rise to 44px together, so the strip is not an exception there.
  **No test asserts a rendered height** (jsdom matches no media query; the
  `pointer-coarse:` tests pin classes), so a green suite is not evidence here. The rule was invisible in an archived
  design doc and got repealed wholesale on `feat/customers-ui-polish` before
  GGA caught it; it is written here so the next reader finds it.

- **Mockup first, for every new module and every changed view.** Decided by
  the owner 2026-10-27, after the agenda shipped without one and its UX was
  rejected. Before any UI task is built, a self-contained HTML mockup
  (`odd/mockups/<feature>/index.html`, tokens copied from
  `globals.css`, light and dark, desktop/tablet/phone) goes to the owner, and
  nothing is built until they approve it.

Writing a component test is a procedure, not a decision — see the
`component-testing` skill.

## Language: Spanish for the user, English for the code

Decided 2026-08-12, final. The split is by AUDIENCE, not by file: a
`"use client"` component holds Spanish strings and English identifiers on the
same line, and that is correct.

- **Spanish** — UI copy, labels, `aria-label`s, validation and error messages,
  empty states, the generated PDF, `scripts/macos/dev.sh` output. Rioplatense, to
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
feature document's `## Log` as a follow-up and in the PR description — not into the
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

**Third known limit — a secure-context-only browser API is invisible on
localhost AND invisible in jsdom.** `crypto.randomUUID()` exists only over
HTTPS or on `localhost`/`127.0.0.1`. The workshop reaches this app from other
machines at `http://192.168.x.x:3000`, where `crypto` is defined but
`randomUUID` is not, so "Agregar vehículo" threw `TypeError:
crypto.randomUUID is not a function` for every user who was not sitting at the
server — while working perfectly on every developer's localhost, and passing
1659 tests, because Node's crypto has the method. It shipped and was found by
an operator, not by us.

So **verification means opening the app at its LAN IP, not at localhost** —
`http://<ip>:3000`, from another machine. That is the only place this class
appears. The same trap is armed for `crypto.subtle`, `navigator.clipboard`,
`mediaDevices`, `geolocation`, service workers and `showSaveFilePicker`: none
are used in a `"use client"` file today (checked 2026-09-12), and adding one
without an insecure-context fallback breaks the workshop and nothing else.

Note what this was NOT: it had nothing to do with Windows, and it was not
introduced by the Windows move. The MacBook plan carried the identical bug,
waiting for the first employee to open the app from a second machine.

## Code quality gate

- **`npm test` and `npx tsc --noEmit` clean before a PR.** Tests always pass:
  nothing merges red, no test is skipped, and no test is deleted or loosened
  to make a run green. A failure unrelated to the change is fixed first or
  reported as a blocker — never waved through.

  Reading a red run: timeouts cascade, so the failure count is not the defect
  count. A test that blows `testTimeout` keeps running and its `userEvent.type`
  keystrokes land on the NEXT test's `document.activeElement`, which then fails
  on text it never typed. **The first timeout in a file is the real failure;
  assertion failures after it are collateral.** Fix the timeout, re-run.

  `testTimeout` is 15s and the `jsdom` project is capped at `maxWorkers: 2`.
  Both numbers were measured, and the measurements live in `vitest.config.ts`
  next to the settings — read them there, not here.

- **`npm run lint`**: 0 errors, **13** warnings (verified 2026-10-06; was 14
  until `closed-order-lock` WU4a dropped an unused test parameter, and 15
  before `list-search-filters` WU1), all pre-existing.
  Don't add to them; clearing them is its own change. Re-run before trusting
  that count.

- **Substantial changes go through the gentle-ai review flow**
  (`gentle-ai review status --contract gentle-ai.review-integration/v2 --agent
  <runtime> --next-transition`), which selects lenses by risk and produces a
  receipt. It caught a merge-blocking defect in `user-lifecycle-management` WU3
  that the full suite passed over.

### GGA — run it before opening a PR

```
gga run --pr-mode --diff-only
```

Configured in `.gga` (v2.10.1): provider `claude`,
`*.ts,*.tsx,*.js,*.jsx,*.mjs,*.ps1` (`.mjs` and `.ps1` added 2026-09-26, after
the backup PR — three files, two of them under `scripts/` — came back "No
matching files changed" with exit 0), excluding only `*.d.ts`, rules from this
file, `TIMEOUT="900"`. No environment variables needed. `gga run --ci` reviews
just the last commit.

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
