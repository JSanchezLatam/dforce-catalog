# Agent Instructions — Dforce Catálogo

This file is read by coding agents (OpenCode, Claude Code, and others) working
in this repository. Keep it current — it should describe standing
conventions and decisions, not a session log. For stack/API/DB reference see
`STACK.md`. For a specific change's detailed rationale, read that change's
`openspec/changes/<name>/design.md` — do not assume this file has the full
story.

## Cross-tool memory note

This project has been worked on via both Claude Code and OpenCode.
Claude Code sessions also persist decisions/history to an MCP memory server
("Engram") that OpenCode cannot read. **Anything a future agent needs
regardless of tool must live in a committed file** — this AGENTS.md,
`STACK.md`, or an `openspec/changes/*/` change's own docs — not only in
Engram. If you're an OpenCode agent and a decision here references "see
Engram", treat this file's summary as the durable source and don't expect to
recover more detail than what's written here.

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
`openspec/changes/crm-workshop-management/tasks.md`'s Review Workload
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
  `openspec/changes/crm-workshop-management/` documents the customer
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
- **No component-testing harness** — `vitest.config.ts` runs `environment:
  "node"`, no `@testing-library/react`/jsdom/happy-dom. Pure logic
  (validation, transitions, scheduling) is unit-tested; pages/forms/client
  components are not, by existing convention. Adding one is a real infra
  change, not a quick add.
- **Security headers** are set in `next.config.ts`. CSP is deliberately not
  configured yet — it needs the actual R2/Interfuerza image hosts allowlisted
  first, or it silently breaks product images app-wide.

## Testing

`npm test` (`vitest run`) — DB-free unit tests, safe to run anywhere.
`src/e2e/**` needs a real reachable Postgres (see `README.md`) and is
excluded from the default run. Strict TDD is the norm in this repo: RED test
first (confirm it fails), then GREEN implementation.
