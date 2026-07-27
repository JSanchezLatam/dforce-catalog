# Tasks: crm-shell-settings-rbac

## Scope boundary — read this before implementing anything

**v1 (this change) ships 10 work units**: 1, 2a, 2b, 3a, 3b, 3c, 4a, 4b, 5a,
5b — role-rename schema, the default-deny permission matrix wired to every
existing route/page, workshop branding settings (logo + name), the grouped
sidebar, and self-service account (profile edit + password change with
session revocation). **~2,913 lines total.**

**Deferred to a separate follow-up SDD change**: work units 6, 7a, 7b, 7c —
deactivation enforcement, the `must_change_password` forced-first-login-change
flow, and the admin user-management CRUD screen (create/edit/deactivate/
reactivate). **~1,175 lines.** Full task detail is preserved, not deleted —
see `## Deferred to follow-up change` at the end of this file. That work was
already planned in full during this phase; it is just not part of this
change's delivery.

### Specs boundary — read by `sdd-verify`

- `specs/user-management/spec.md` (the entire file) describes **deferred**
  behavior. None of its requirements are v1 acceptance criteria.
- `specs/user-account/spec.md` is **split**: "Self-Service Profile View",
  "Profile Edit — Name and Email Only", "Email Validation", "Password Change
  with Current-Password Confirmation", "Session Revocation on Password
  Change", and "Email Change Does Not Revoke Sessions" ARE v1 scope (built in
  WU5a/5b). "Forced Password Change on First Login", "Forced-Change Screen
  Stays Reachable", "New Password Must Differ From the Temporary One", and
  "Flag Clears Immediately on Successful Forced Change" are **deferred** —
  `sdd-verify` must not fail v1 for not implementing them.
- Do not edit the spec files themselves to reflect this split — that is a
  future `sdd-spec` action on the follow-up change, not a `tasks`/`apply`
  action on this one.

### Accepted trade-off in v1

With no user-management UI, **creating a NEW técnico requires a manual DB
insert** (e.g. via `scripts/seed-user.mjs`, which already accepts a role
argument) until the follow-up change ships. This is a real, visible gap —
state it in the tracker PR description so nobody expects a "create user"
button in v1. It does not block verifying the two-role matrix end to end:
every **existing** `usuario` row becomes `tecnico` automatically via WU1's
enum `RENAME VALUE`, so a real técnico account already exists in every
environment without any manual step.

### Dead-columns decision — resolved, not left to `sdd-apply`

**`users.deactivatedAt` and `users.must_change_password` SHIP in WU1's
migration now**, even though no v1 code path reads or writes them yet.

**Reasoning**: `design.md`'s own rollout notes already made this call before
the scope cut ("All four new columns ship in **one** migration — a second
migration later for user management would be pure churn") and the user's
scope-cut decision didn't reverse that specific reasoning, only the
UI/enforcement scope. Both columns are inert-safe additions — nullable
(`deactivatedAt`) or `NOT NULL DEFAULT false` (`must_change_password`) — with
zero v1 consumers, so there is no behavioral risk in shipping them early.
Doing so avoids a second `ALTER TABLE users ...` migration in the follow-up
touching a table WU1 already migrates once for the enum rename, which is the
same "avoid pure churn" logic behind hand-editing a generated migration
rather than writing one from scratch.

**Mitigation for reviewer confusion**: `schema.ts` gets an inline comment on
both columns — `// reserved for the crm-shell-settings-rbac user-management
follow-up — no v1 code path reads or writes this` — and the same phrasing
goes in WU1's PR description. `schema.test.ts` still asserts their
nullability/default (cheap, and it locks the shape so the follow-up can't
silently drift from what WU1 actually shipped) — this is a schema-shape
assertion only, not a v1 behavioral acceptance criterion, consistent with the
specs-boundary note above.

### `Configuración` nav group has two children in v1, not three

**`Gestión de usuarios` MUST NOT appear in the sidebar in v1** — `/users` is
entirely deferred, and unlike the original 4-vs-7 "ships one step early"
timing hazard, this is now a **permanent** v1 state, not a temporary window
before the next unit lands. WU4a/4b below build `Configuración` with exactly
two children (`Config. del CRM`, `Config. de catálogos` → nested
`Configuración de template`) and add the third in the follow-up change's own
nav-items task. See WU4a.3 for the explicit task and the re-checked
`pinBottom` reasoning.

### Atomicity rules — re-verified after the cut

- **2a + 2b must still land together** before the tracker branch merges to
  `main`. Nothing about the scope cut changes this: an unwired matrix (2a
  alone) is inert and safe to sit in the chain; wiring gates without a
  complete, tested matrix is not. This is the one atomicity rule that
  survives the cut intact.
- **The "WU6 before/with WU7" coupling has left v1 entirely.** Do not hunt
  for it in this chain — WU6 and WU7a/b/c are both deferred together to the
  follow-up change, where that same coupling will apply again inside that
  change's own tasks. v1's chain has no unit that depends on deactivation or
  forced-password-change.

### Chain strategy — decided: `feature-branch-chain`

A draft/no-merge tracker branch accumulates all 10 v1 slices; PR #1 targets
the tracker, each subsequent child PR targets the immediately previous PR's
branch; **only the tracker merges to `main`**. Chosen over `stacked-to-main`
because independent merges to `main` would let the permission matrix reach
`main` before every route/page gate is wired to it — a security state
(routes silently still open), not merely an incomplete feature. Matches this
project's own precedent on `crm-workshop-management` and
`adaptive-catalog-layouts`.

```
tracker (draft, no-merge)
  └── PR1 schema
        └── PR2a policy+guard+registry
              └── PR2b wire all gates
                    ├── PR3a workshop service+logo+r2
                    │     └── PR3b workshop routes
                    │           └── PR3c workshop page
                    └── PR4a nav data model
                          └── PR4b sidebar rendering+layout ── (needs 3c too)
                                └── PR5a account service
                                      └── PR5b account routes+page
                                            └── tracker merges main
```

Every work unit's rollback boundary below is stated in terms of this
topology: "revert" means drop that PR's branch from the chain and rebase the
next branch onto the one before it — never a plain revert-on-`main`, since
nothing but the tracker ever reaches `main`.

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines (v1) | **~2,913** across 10 work units, ~54 files |
| 400-line budget risk | **Low per unit** (every unit below is ≤390 lines by pre-declared split) / **Medium in aggregate** for a 10-PR chain |
| Chained PRs recommended | **Yes** |
| Decision needed before apply | **No** — scope (10 v1 units, deactivation/user-mgmt deferred) and chain strategy (`feature-branch-chain`) are both now decided by the user. `sdd-apply` can proceed directly. |
| Delivery strategy | `ask-on-risk` (already resolved at this guard — no further asks needed for v1) |
| Chain strategy | **`feature-branch-chain`** — tracker + linear child chain, only tracker merges `main` |

### v1 Work Units (dependency-ordered)

| Unit | Goal | Est. lines | Files | Depends on |
|---|---|---|---|---|
| 1 | Schema + migration (incl. reserved `deactivatedAt`/`must_change_password` columns) + role-rename callers | ~270 | 10 | tracker |
| 2a | Policy matrix + `guard.ts` + `ROUTE_GUARDS` framework (registry + fs-completeness only, no route wiring yet) | ~315 | 7 | 1 |
| 2b | Apply `can()`/`withAuthorization` gates to **every** existing route + page; behavioral 403 assertions in `route-guards.test.ts` | ~265 | 19 | 2a |
| 3a | `workshop-config` service + `logo.ts` (pure sniff/cap/sanitize) + `r2.ts` param + PDF regression test | ~353 | 6 | 1 |
| 3b | Workshop-config routes (JSON + multipart + sandboxed serving) + R2-privacy verification | ~310 | 4 | 3a |
| 3c | Workshop settings page + form + upload widget | ~160 | 3 | 3b |
| 4a | `nav-items.ts` grouped/nested data model (two-child `Configuración`) + `pinBottom` + filtering tests | ~260 | 2 | 2b |
| 4b | `AppSidebar` groups/collapsed-dropdown/header/footer + `WorkshopLogo` + `layout.tsx` wiring + minimal `account/queries.ts` (pulled forward) | ~300 | 5 | 4a, 3c |
| 5a | `account/service.ts` profile+password logic + `revokeOtherSessions()` | ~280 | 4 | 1 |
| 5b | Account routes + `/account` page + forms | ~390 | 7 | 5a, 4b |

**Total v1: ~2,913 lines, ~54 files, 10 chained work units.** None exceeds
400 lines. Pre-declared splits carried over from the original (larger) plan:

- **Work unit 2** (matrix + all gates) was a single ~580-line unit before
  splitting into 2a/2b. 2a ships the matrix, `can()`, the guard wrapper, and
  a registry whose fs-enumeration test only checks *presence* of an entry
  per route/page (safe — an unwired matrix is inert). 2b wires every
  route/page and adds the behavioral 403 assertions. **Both must land before
  the tracker merges to `main`.**
- **Work unit 3** (workshop settings) was a single ~823-line unit, split into
  3a (pure logic), 3b (routes), 3c (page+form).
- **Work unit 4** (sidebar) was a single ~570-line unit (~560 now, two-child
  Configuración trims a handful of lines from the original three-child
  estimate — noise-level, not re-tallied). Split into 4a (data model, zero
  UI) and 4b (rendering + wiring).
- **Work unit 5** (account) was a single ~670-line unit, split into 5a
  (business logic, DB-free tests) and 5b (transport + UI). **5b at ~390
  lines is the tightest margin in v1** — pre-declared internal split point
  if it grows past 400 during implementation: peel `PasswordForm.tsx` +
  `app/api/account/password/route.ts` (+test) into their own trailing PR
  (`5b-i` routes+page, `5b-ii` password form+route), same dependency
  ordering, no other rework needed.

### Work-unit boundaries (start / finish / verify / rollback)

| Unit | Start | Finish | Verify | Rollback (feature-branch-chain) |
|---|---|---|---|---|
| 1 | branch off tracker | migration 0007 applied, `tsc` sees new `Role`/columns everywhere, incl. the two reserved columns | `npm test` green; `drizzle-kit generate` emits nothing new | drop this branch from the chain; a new `0008` reverse migration if 1 already merged into a later branch, never delete 0007 |
| 2a | branch off 1 | `MATRIX`/`can()`/`guard.ts` exist; registry completeness test green | `npm test` green (registry entries exist, no behavioral assertions yet) | drop this branch; rebase 2b onto 1 directly if 2a is abandoned before 2b starts |
| 2b | branch off 2a | every route/page calls `can()`/`withAuthorization` | `npm test` green incl. 403 assertions; manual click-through per role | drop 2a+2b together — never partially; rebase 3a/4a onto 1 if the whole matrix slice must be pulled |
| 3a | branch off 1 | service+logo+r2 pure logic pass unit tests | `npm test` green; PDF-path regression test green | drop this branch; rebase 3b onto 1 |
| 3b | branch off 3a | 3 routes exist, registered in `ROUTE_GUARDS` | `npm test` green; manual R2-privacy check (see 3b.5) | drop this branch; rebase 3c onto 3a |
| 3c | branch off 3b | settings page renders, saves via 3b's routes | manual: upload/replace/clear logo, no layout shift | drop this branch; rebase 4b onto 3b (loses the settings page only) |
| 4a | branch off 2b | `getNavGroups()` returns exact two-group/two-child-Configuración trees per role | `npm test` green (`nav-items.test.ts`) | drop this branch; rebase 4b onto 2b |
| 4b | branch off 4a, 3c | sidebar renders groups/header/footer; layout wires it all | `npm test` green; manual: collapsed-rail keyboard reachability of nested item | drop this branch; rebase 5b onto 4a (shell falls back to flat nav) |
| 5a | branch off 1 | profile/password service functions pass unit tests | `npm test` green (wrong-password-no-write, revocation call, dup-email) | drop this branch; rebase 5b onto 1 |
| 5b | branch off 5a, 4b | `/account` usable end-to-end | `npm test` green; manual: change password, confirm tab B logged out, tab A survives | drop this branch (last in chain); tracker simply doesn't merge until re-done |

**Tracker merge gate**: the tracker branch stays draft/no-merge until PR1
through PR5b are all reviewed and integrated into the chain — `main` never
sees a partially-applied matrix or a half-built shell.

---

## Work Unit 1 — Schema + Migration

Target files: `src/shared/db/schema.ts`, `src/modules/auth/roles.ts`,
`src/modules/auth/roles.test.ts`, `src/shared/db/schema.test.ts`,
`src/shared/db/migrations/0007_*.sql` (+ generated `meta/0007_snapshot.json` +
`_journal.json`), `src/modules/inventory-view/InventoryStatsHeader.tsx`,
`scripts/seed-user.mjs`, `src/e2e/full-flow.e2e.test.ts`, `README.md`.

- [ ] 1.1 RED `roles.test.ts` — `isRole()` truth table (`"tecnico"` → true,
      `"administrador"` → true, anything else → false, incl. `undefined`/`""`).
- [ ] 1.2 GREEN `src/modules/auth/roles.ts` — `Role`, `ROLES`, `ROLE_LABELS`,
      `isRole()` per design Decision 1a.
- [ ] 1.3 RED `schema.test.ts` (extend existing) — `roleEnum.enumValues ===
      ["tecnico", "administrador"]`; `users.name` nullable; `users.email`
      nullable + unique; `users.deactivatedAt` nullable; `users.mustChangePassword`
      notNull + default `false`; `workshop_config` column set/nullability via
      `getTableConfig`. The `deactivatedAt`/`mustChangePassword` assertions
      check SHAPE ONLY (nullability/default) — no behavior depends on them in
      v1; see "Dead-columns decision" above.
- [ ] 1.4 GREEN `schema.ts` — rename `roleEnum` values, add `users.name`,
      `users.email` (unique), `users.deactivatedAt`, `users.mustChangePassword`
      (both with an inline comment: `// reserved for the
      crm-shell-settings-rbac user-management follow-up — no v1 code path
      reads or writes this`); add `workshop_config` singleton table (`id`,
      `name` nullable, `logoR2Key`, `logoContentType`, `updatedAt`).
- [ ] 1.5 Run `npx drizzle-kit generate` — produces `0007_*.sql` +
      `meta/0007_snapshot.json` + journal entry, machine-authored, matching
      `schema.ts` from 1.4.
- [ ] 1.6 Hand-edit **only the SQL body** of the generated 0007 file: prepend
      `ALTER TYPE "public"."role" RENAME VALUE 'usuario' TO 'tecnico'` +
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'tecnico'` before the
      drizzle-generated column-add statements; append
      `UPDATE "users" SET "name" = "username" WHERE "name" IS NULL` after the
      `name` column is added. Do not hand-edit `meta/0007_snapshot.json` or
      `_journal.json` — precedent `0004_stock_to_real.sql`.
- [ ] 1.7 Verification (manual, not `npm test`): re-run
      `npx drizzle-kit generate` and confirm it produces **no new migration**
      — proves 0007's hand-edited SQL still matches `schema.ts`.
- [ ] 1.8 Update string-literal `usuario` → `tecnico` callers:
      `scripts/seed-user.mjs` (lines 9-17), `src/e2e/full-flow.e2e.test.ts`
      (type literals), `README.md`. Do NOT trust `STACK.md` — it is stale and
      out of scope to fix here.
- [ ] 1.9 RED/GREEN `src/modules/inventory-view/InventoryStatsHeader.tsx:4` —
      the current `Record<SessionUser["role"], string>` local map will fail to
      compile once the enum renames (missing `"tecnico"` key / stale
      `"usuario"` key). Delete the local map, import `ROLE_LABELS` from
      `src/modules/auth/roles.ts` instead. Explicit task per hard constraints
      — this is the live proof the matrix-forcing-function works.

---

## Work Unit 2a — Policy Matrix + Guard + Registry Framework

Target files: `src/modules/auth/policy.ts`, `src/modules/auth/policy.test.ts`,
`src/modules/auth/guard.ts`, `src/modules/auth/guard.test.ts`,
`src/modules/auth/route-guards.test.ts`.

- [ ] 2a.1 RED `policy.test.ts` — rewrite as an **independent hand-written**
      cross-product table: for every one of the 13 `Action`s (`customers.read`,
      `customers.write`, `service-orders.read`, `service-orders.write`,
      `inventory.read`, `catalogs.read`, `catalogs.download`,
      `catalogs.generate`, `catalogs.listAll`, `template.edit`,
      `workshop.edit`, `users.manage`, `sync.manual`, `account.self`) ×
      2 roles, assert an explicit expected boolean (26 assertions, literal
      booleans — do NOT derive expectations from `MATRIX` itself, that would
      be tautological). **`users.manage` stays in the `Action` union and the
      matrix even though its only v1 consumer (the deferred WU7's routes) is
      not built here** — the action is real (role-permissions spec table
      lists it), it is just unreferenced by any v1 route; `2a.7`'s "every
      Action is route-reachable" completeness check must special-case this
      one known exception (state it inline in the test, do not silently skip
      it). Plus: `can({role:"ghost"}, ...)` → `false`, never throws.
- [ ] 2a.2 GREEN `policy.ts` — `ACTIONS` union (14 actions per `role-permissions`
      spec table, including `account.self`), `type Grants = { readonly [A in
      Action]: boolean }` (total, NOT `ReadonlySet`), `MATRIX: { readonly [R
      in Role]: Grants }`, `can(user, action)` default-deny for unknown role.
- [ ] 2a.3 RED `guard.test.ts` — `withAuthorization(action, handler)` returns
      403 JSON `{ error: "Forbidden" }` before invoking `handler` when
      `can()` is false; invokes `handler` normally when true; does not touch
      DB/business logic on the denied path.
- [ ] 2a.4 GREEN `guard.ts` — implement `withAuthorization` per design
      Decision 1b.
- [ ] 2a.5 RED `route-guards.test.ts` — declare `ROUTE_GUARDS` registry
      (`Record<string, Partial<Record<"GET"|"POST"|"PATCH"|"DELETE",
      Action | "session-only">>>`) covering every route/page that exists
      **today** (see file list in 2b) plus `/login` and `/api/login` pinned
      `"session-only"`. Write the `fs.readdirSync(src/app, { recursive: true
      })` completeness test asserting every `api/**/route.ts` and
      `(app)/**/page.tsx` has an entry — this MUST fail red right now because
      most existing routes/pages have no entry yet.
- [ ] 2a.6 GREEN — fill in the registry so 2a.5's completeness test passes.
      Do NOT yet add the per-route 403 behavioral assertions (routes aren't
      wired to `can()` yet — that's 2b, on purpose: an unwired registry entry
      is inert, not a security gap).
- [ ] 2a.7 Explicit task — assert `expect(new Set(Object.values(ROUTE_GUARDS)
      .flatMap(...)))` covers every `Action` **except `users.manage`**
      (deferred, no v1 route), catching an action defined but wired nowhere
      for every other action.
- [ ] 2a.8 Explicit task, honesty note (write as a code comment in
      `route-guards.test.ts`, not just here): this registry cannot catch an
      entry naming the WRONG action, and `page.tsx` Server Components get
      registry-completeness only, never behavioral 403 assertion (async RSC +
      `headers()` are not invocable under vitest's `node` environment).

---

## Work Unit 2b — Wire Every Route + Page to the Matrix

Target files (existing, all gain a `can()`/`withAuthorization` call):
`src/app/api/template-config/route.ts`,
`src/app/api/catalog-builder/products/route.ts`,
`src/app/api/catalog-builder/generate/route.ts`,
`src/app/api/catalog-builder/queue-depth/route.ts`,
`src/app/api/catalogs/[id]/file/route.ts`,
`src/app/api/inventory-sync/manual/route.ts`,
`src/app/api/customers/route.ts`, `src/app/api/customers/[id]/route.ts`,
`src/app/api/service-orders/route.ts`,
`src/app/api/service-orders/[id]/route.ts`,
`src/app/(app)/template-config/page.tsx`, `src/app/(app)/inventory/page.tsx`,
`src/app/(app)/inventory/[id]/page.tsx`, `src/app/(app)/builder/page.tsx`,
`src/app/(app)/catalogs/page.tsx`, `src/app/(app)/customers/page.tsx`,
`src/app/(app)/customers/[id]/page.tsx`,
`src/app/(app)/service-orders/page.tsx`,
`src/app/(app)/service-orders/[id]/page.tsx`.
Plus extending `route-guards.test.ts` from 2a with behavioral assertions.

- [ ] 2b.1 RED — extend `route-guards.test.ts`: for each API entry with a
      real `Action` (not `"session-only"`), import the module and invoke with
      forged `x-user-id`/`x-user-role: tecnico` headers; assert 403 whenever
      `MATRIX.tecnico[action] === false`. Must fail red until 2b.2-2b.5 wire
      the routes.
- [ ] 2b.2 GREEN — `customers`, `service-orders` routes (list/create/detail/
      edit): add `can(requireSession(request), "customers.read"|"customers.write"
      |"service-orders.read"|"service-orders.write")` per `customer-management`/
      `service-orders` delta specs. Outcome is always `true` for both roles —
      gate must still be PRESENT (spec: "Gate must be present, not assumed").
- [ ] 2b.3 GREEN — `catalog-builder/generate/route.ts`: gate on
      `catalogs.generate` (false for técnico — breaking, intended, per
      `catalog-generation` delta spec). `catalog-builder/products`,
      `queue-depth`: gate on `catalogs.read` or equivalent per spec table.
- [ ] 2b.4 GREEN — `catalogs/[id]/file/route.ts`: gate on `catalogs.read`/
      `catalogs.download`; existing `isOwner` ownership check stays
      hand-written/hand-tested, unaffected by this gate (design 1b's stated
      limitation — gating and ownership are separate concerns).
- [ ] 2b.5 GREEN — `template-config/route.ts` (already has an inline
      admin-only check pre-change): replace with `can(user, "template.edit")`
      for consistency; `inventory-sync/manual/route.ts`: gate on
      `sync.manual`.
- [ ] 2b.6 GREEN — every existing `(app)/**/page.tsx` above: add the same
      `requireSessionFromHeaders()` + `can()` inline-check-and-fallback-UI
      pattern already used by `template-config/page.tsx` (design's own
      precedent), for the action matching that page's route table entry.
      `builder/page.tsx` gates on `catalogs.generate`.
- [ ] 2b.7 Run `npm test` — full suite green, including every 403 assertion
      from 2b.1 and the completeness assertions from 2a.

---

## Work Unit 3a — Workshop Config Service + Logo Validation + R2 Param

Target files: `src/modules/workshop-config/service.ts`,
`src/modules/workshop-config/service.test.ts`,
`src/modules/workshop-config/logo.ts`,
`src/modules/workshop-config/logo.test.ts`,
`src/modules/catalog-storage/r2.ts`, `src/modules/catalog-storage/r2.test.ts`
(new or extended).

- [ ] 3a.1 RED `service.test.ts` — `validateWorkshopConfigInput` pure
      function (mirrors `template-config/service.test.ts`); `getWorkshopConfig()`
      returns `null` when unsaved; `saveWorkshopConfig()` uses
      `onConflictDoUpdate` on the singleton row.
- [ ] 3a.2 GREEN `service.ts` per design Decision 3.
- [ ] 3a.3 RED `logo.test.ts` — magic-byte sniff per format (PNG `89 50 4E
      47`, JPEG `FF D8 FF`, WebP `"RIFF"..."WEBP"`, SVG `"<?xml"|"<svg"`);
      2MB raster cap / 512KB SVG cap (accept-at-limit and reject-over-limit
      cases); SVG reject cases: `<script>`, `<foreignObject>`, `on*=`, remote
      `xlink:href`/`href`, `<!DOCTYPE`, `<!ENTITY`, `<a>`; sanitized-output
      stability (strip comments/`<style @import>`/non-local `<use>`, keep
      everything else byte-stable); corrupt/malformed file → reject.
- [ ] 3a.4 GREEN `logo.ts` — pure pipeline per design Decision 4: size gate →
      magic-byte sniff → SVG reject-or-sanitize → return `{ buffer,
      contentType, ext }`. No DB/R2 access in this file.
- [ ] 3a.5 RED `r2.test.ts` — **regression test**: existing PDF callers
      (`putObject(key, buffer)` with no third arg) still get
      `Content-Type: application/pdf` after the signature change. This MUST
      pass unmodified — it is the proof the generalization is backward
      compatible.
- [ ] 3a.6 GREEN `r2.ts` — `putObject(key, body, contentType =
      "application/pdf")`. Zero diff required outside this file for existing
      PDF callers.

---

## Work Unit 3b — Workshop Config Routes

Target files: `src/app/api/workshop-config/route.ts` (+ test),
`src/app/api/workshop-config/logo/route.ts` (+ test). Extends
`route-guards.test.ts` with the two new entries.

- [ ] 3b.1 RED `workshop-config/route.test.ts` — `GET` returns current config
      or nulls when unsaved (gated `workshop.read`); `POST` validates+saves
      name only, gated `workshop.edit`, 403 for técnico.
- [ ] 3b.2 GREEN `workshop-config/route.ts`.
- [ ] 3b.3 RED `workshop-config/logo/route.test.ts` — multipart `POST`:
      accepts valid raster/SVG, rejects invalid per 3a's `logo.ts` cases,
      calls `putObject` then best-effort `deleteObject(previousKey)`; `DELETE`
      clears the stored key; `GET` streams bytes with `Content-Type` from the
      **stored** value (never `file.type`), `Content-Disposition: inline`,
      the `Content-Security-Policy: default-src 'none'; style-src
      'unsafe-inline'; sandbox` header, `X-Content-Type-Options: nosniff`,
      `Cache-Control: private, max-age=60` + `ETag` from `logoR2Key`. All
      three gated `workshop.edit` except `GET` (`workshop.read`, granted to
      both roles).
- [ ] 3b.4 GREEN `workshop-config/logo/route.ts` per design Decision 4's
      pipeline diagram.
- [ ] 3b.5 Register both routes in `ROUTE_GUARDS` (2a's fs-enumeration test
      will fail on this unit's new files otherwise).
- [ ] 3b.6 **Verification task (not a code change)**: confirm the R2 bucket
      can stay fully private now that the logo streams only through
      `GET /api/workshop-config/logo` — check the bucket's access policy
      against `env.ts`'s `R2_PUBLIC_URL` documentation ("display-only, never
      used to serve downloads directly") and record the finding in this PR's
      description. Resolves design's Open Question #1 / Round 4 decision #3.

---

## Work Unit 3c — Workshop Settings Page + Form

Target files: `src/modules/workshop-config/WorkshopConfigForm.tsx`,
`src/modules/workshop-config/LogoUploadField.tsx`,
`src/app/(app)/workshop-config/page.tsx`.

- [ ] 3c.1 `WorkshopConfigForm.tsx` — sectioned form (name field only in v1,
      shaped for future sections per design Decision 3), POSTs to 3b's JSON
      route, `FIELD_ERROR` pattern matching `TemplateConfigForm`.
- [ ] 3c.2 `LogoUploadField.tsx` — multipart upload to 3b's logo route,
      client-side preview, explicit copy stating the logo saves immediately
      on upload (before the text form's "Guardar" — accepted cost per design
      Decision 4).
- [ ] 3c.3 `workshop-config/page.tsx` — "Config. del CRM", admin-only fallback
      UI matching the `template-config/page.tsx` pattern; register in
      `ROUTE_GUARDS`.

---

## Work Unit 4a — Nav Data Model (two-child `Configuración`)

Target files: `src/modules/layout/nav-items.ts` (rewrite),
`src/modules/layout/nav-items.test.ts` (rewrite).

- [ ] 4a.1 RED `nav-items.test.ts` — asserts the **exact** group/label tree
      for `administrador` (3 groups: CRM/Catálogo/Configuración; Configuración
      has exactly **two** children in v1 — "Config. del CRM" and
      "Config. de catálogos" → nested "Configuración de template" — NO
      "Gestión de usuarios" item exists in this tree at all, not even hidden)
      and for `tecnico` (2 groups, 4 items, Configuración entirely absent).
      Empty-group pruning: a group with zero surviving items is dropped, not
      rendered-empty. Parent-denied-drops-children: a denied `NavParent` is
      removed along with its `children`. **Explicit `pinBottom` test,
      re-checked for two children**: build an administrador tree and assert
      `Configuración` (now 2 items instead of 3) still renders `pinBottom:
      true`/`mt-auto`; build a técnico tree and assert nothing renders
      pinned — i.e. "nothing pins when the Configuración group is absent"
      holds regardless of child count, since técnico still sees zero
      children either way (both remaining items are admin-gated:
      `workshop.edit`, `template.edit`).
- [ ] 4a.2 GREEN `nav-items.ts` — `NavLink`/`NavParent`/`NavGroup` types per
      design Decision 5 (`children: readonly NavLink[]`, no third nesting
      level possible); `pinBottom?: boolean` explicit flag on the
      `Configuración` group, NOT derived from array position;
      `getNavGroups(user): NavGroup[]` filters by `can()` per item's optional
      `action`. **Do not add a "Gestión de usuarios" entry at all in v1** —
      not commented out, not gated-and-hidden; the item simply does not exist
      in this file until the follow-up change adds it.
- [ ] 4a.3 Explicit task — **`Configuración` permanently ships with two
      children in v1, not three.** This replaces the original plan's "nav
      appears one step before the page exists" note (that was a temporary
      timing gap when user-management was in-scope for this same change; now
      that WU7 is a separate follow-up change, there is no future unit in
      *this* chain that adds the third item). State in this PR's description:
      "Gestión de usuarios ships in the crm-shell-settings-rbac follow-up
      change, together with `/users`." Nothing 404s in v1 because nothing
      points at a route that doesn't exist.

---

## Work Unit 4b — Sidebar Rendering + Layout Wiring

Target files: `src/components/app-sidebar.tsx` (rewrite),
`src/components/WorkshopLogo.tsx` (new), `src/app/(app)/layout.tsx`,
`src/modules/account/queries.ts` (new, minimal), `src/modules/account/queries.test.ts`.

- [ ] 4b.1 RED `queries.test.ts` — `getUserProfile(userId)` returns
      `{ username, name, email, role }` or throws/returns null for an unknown
      id (DI query seam, same convention as `customers/queries.ts`).
- [ ] 4b.2 GREEN `src/modules/account/queries.ts` — implement just this one
      read function now (WU5a adds the rest of the account module later).
      **Why pulled forward**: `design.md`'s own data-flow diagram wires
      `getUserProfile()` into `layout.tsx` at this step, but its File Changes
      table put the whole `account/` module in a later step — that's an
      ordering gap in the design; resolved here by creating only the read
      query early and leaving mutations for WU5a.
- [ ] 4b.3 `WorkshopLogo.tsx` (client) — `<img src={"/api/workshop-config/logo?v="+version}>` inside the existing fixed `size-8 rounded-lg`
      box; `onError` and no-`logoR2Key` both fall back to `GalleryVerticalEnd`;
      reserves its space unconditionally (no layout shift).
- [ ] 4b.4 `app-sidebar.tsx` rewrite: render `NavGroup[]` with
      `SidebarGroup`/`SidebarGroupLabel`/`SidebarGroupContent`; `Configuración`
      group (two children in v1, see WU4a) gets `className="mt-auto"` driven
      by `group.pinBottom`, nothing else; `<SidebarGroup role="group"
      aria-labelledby={labelId}>` + `<SidebarGroupLabel id={labelId}>`
      (unconditional, both expanded and collapsed); a `SidebarSeparator`
      between every group; collapsed-state (`useSidebar().state ===
      "collapsed"`) renders a `NavParent` as a `DropdownMenu` (`side="right"`)
      whose **trigger is a button, not a `Link`** (per design's revision —
      `Enter` must not both navigate and open the menu), with the parent's
      own destination as the first item inside the dropdown; expanded
      renders `SidebarMenuSub` as today. Header collapses to single line:
      logo + name only, no "Catálogos" subtitle. Footer: `name ?? username`
      on line 1, `ROLE_LABELS[role]` on line 2, avatar initial from the same
      source.
- [ ] 4b.5 `layout.tsx` — fetch `getUserProfile(user.id)`,
      `getWorkshopConfig()` (React `cache()`-wrapped per design), and
      `getNavGroups(user)`; pass all three into `AppSidebar`.
- [ ] 4b.6 Manual verification checklist (record in PR body, not automated —
      async RSC + real browser needed): keyboard-only reachability of
      "Configuración de template" when collapsed (Tab → trigger → `Enter` →
      arrow keys → `Escape` → focus returns to trigger); logo appears with no
      layout shift on slow network.

---

## Work Unit 5a — Account Service Logic

Target files: `src/modules/account/service.ts` (new),
`src/modules/account/service.test.ts`, `src/modules/auth/session.ts` (add
`revokeOtherSessions`), `src/modules/auth/session.test.ts`.

- [ ] 5a.1 RED `session.test.ts` — `revokeOtherSessions(userId, keepTokenId)`
      sets `revoked_at = now()` for every session of `userId` except
      `keepTokenId`; `keepTokenId = null` revokes all.
- [ ] 5a.2 GREEN `session.ts` — implement per design's SQL shape
      (`WHERE user_id = $1 AND revoked_at IS NULL AND ($2 IS NULL OR id <>
      $2)`).
- [ ] 5a.3 RED `service.test.ts` — `updateProfile()`: persists `name`/`email`;
      ignores a submitted `username` change (spec: "MUST be ignored", not
      rejected); email format validation; duplicate-email → 409-style error,
      EXCEPT when the email is unchanged from the user's own current value
      (explicit "unchanged own email not flagged as duplicate" test case).
- [ ] 5a.4 RED `service.test.ts` — `changePassword()`: wrong
      `currentPassword` → rejection AND **no hash write** (assert the mock
      DB update was never called, not just that the response is an error);
      correct password → hash updated, `revokeOtherSessions(userId,
      keepTokenId)` called. **v1 scope note**: do NOT implement the
      `mustChangePassword`-clearing branch here — that flag and its clearing
      rule belong to the deferred forced-change flow (WU6, follow-up
      change). `changePassword()` in v1 only ever handles a voluntary,
      self-initiated change.
- [ ] 5a.5 GREEN `service.ts` — implement `updateProfile`, `changePassword`
      satisfying 5a.3-5a.4.

---

## Work Unit 5b — Account Routes + Page

Target files: `src/app/api/account/route.ts` (+ test),
`src/app/api/account/password/route.ts` (+ test),
`src/app/(app)/account/page.tsx`, `src/modules/account/ProfileForm.tsx`,
`src/modules/account/PasswordForm.tsx`.

**Pre-declared split point if this unit grows past 400 lines during
implementation** (forecast ~390, tightest margin in v1): peel
`PasswordForm.tsx` + `src/app/api/account/password/route.ts` (+ test) into a
trailing `5b-ii` PR, keeping `ProfileForm.tsx` + `src/app/api/account/route.ts`
+ `account/page.tsx` as `5b-i`; `5b-ii` targets `5b-i`'s branch, same
dependency ordering, no other rework needed.

- [ ] 5b.1 RED `account/route.test.ts` — `GET` returns own profile; `PATCH`
      calls `updateProfile`, 400 on validation errors, 409 on duplicate email.
- [ ] 5b.2 GREEN `account/route.ts`.
- [ ] 5b.3 RED `account/password/route.test.ts` — `POST` calls
      `changePassword`; 400 + no-hash-write on wrong current password;
      success revokes other sessions (assert via injected deps, no DB). Do
      NOT assert any `mustChangePassword` clearing here — v1's route never
      sets or reads that flag (see WU5a.4 note).
- [ ] 5b.4 GREEN `account/password/route.ts`; register both new routes in
      `ROUTE_GUARDS` gated `account.self` (both roles: true).
- [ ] 5b.5 `ProfileForm.tsx` — `username` shown read-only, `name`/`email`
      editable.
- [ ] 5b.6 `PasswordForm.tsx` — current/new/confirm fields, explains
      "other sessions will be signed out" copy.
- [ ] 5b.7 `account/page.tsx` — mounts both forms, fetches via 5b.1's `GET`.

---

## Deferred to follow-up change

Everything below was fully planned during this phase and is preserved
verbatim for the follow-up SDD change to pick up — it is **not** part of
this change's delivery, not gated on it beyond the dependencies stated, and
`sdd-verify` for `crm-shell-settings-rbac` v1 must not check any of it.

### ⚠ Spec/Decision reconciliation carried over — user list default view

`specs/user-management/spec.md`'s "Deactivated Users Remain Visible and
Attributable" requirement says a deactivated user "MUST still appear ... not
hidden or filtered out by default." Round 4 decision #1 (binding, settles the
design's open question #2) says the opposite on its face: the list shows
**active users by default** with a "Mostrar inactivos" toggle; inactive rows
are reachable, not permanently hidden. Read literally these conflict.

**Resolution to carry into the follow-up**: follow the binding Round 4
decision (default active-only + toggle + "Reactivar" action). The spec
requirement's intent — "a deactivated user is never erased or unreachable" —
is satisfied by the toggle (one click reveals them; nothing is permanently
hidden or deleted). The spec's literal wording is stricter than what was
actually decided; the follow-up change's own `sdd-spec`/`sdd-verify` pass
should correct the spec text rather than treat this as unresolved again.

### Dependency note for the follow-up

WU6 depends on v1 units **1** (schema — the two reserved columns already
exist, ship-ready), **5a** (extends `account/service.ts` and reuses
`changePassword()`), and **2b** (extends `route-guards.test.ts`, already
established). WU7a depends on **5a** and **WU6**. The follow-up change's own
tasks phase should re-verify these against whatever state v1 actually merged
in, but the dependency shape itself does not need to be rediscovered.

### Deferred Work Unit 6 — Deactivation + Forced-Change Enforcement

**Must land before or with deferred Work Unit 7 — never after.** Target
files: `src/modules/auth/session.ts` (`isUserActive`, `validateSession`
projection, `SessionUser.deactivatedAt`/`mustChangePassword`),
`src/modules/auth/authenticate.ts`, `src/modules/auth/forced-change.ts` (new),
`src/proxy.ts`, `src/app/(app)/change-password/page.tsx` (new),
`route-guards.test.ts` (extend).

- [ ] 6.1 RED `session.test.ts` — `isUserActive({ deactivatedAt: null })` →
      true; `isUserActive({ deactivatedAt: <Date> })` → false.
- [ ] 6.2 GREEN `session.ts` — add `isUserActive()`.
- [ ] 6.3 RED `session.test.ts` — `validateSession()` (inject the joined row,
      no real DB): returns `null` for an otherwise-valid session belonging to
      a deactivated user; returns `null` unchanged for the existing
      expired/revoked cases; on success, `SessionUser` now carries
      `deactivatedAt`/`mustChangePassword` alongside `id`/`role`.
- [ ] 6.4 GREEN `session.ts` — add `deactivatedAt`/`mustChangePassword` to the
      `validateSession` projection (same `innerJoin`, zero extra queries);
      `if (!row || !isSessionActive(row) || !isUserActive(row)) return null`.
- [ ] 6.5 RED `authenticate.test.ts` — a deactivated user's login attempt with
      a correct password returns the **same generic error** as a wrong
      password (no account-state enumeration).
- [ ] 6.6 GREEN `authenticate.ts` — refuse deactivated users identically to a
      bad password.
- [ ] 6.7 RED `forced-change.test.ts` — `isPasswordChangeExempt(CHANGE_PASSWORD_PATH)`
      → true; `isPasswordChangeExempt("/api/account/password")` → true;
      `isPasswordChangeExempt("/api/logout")` → true;
      `isPasswordChangeExempt("/some/other/route")` → false. This is the
      anti-infinite-loop test.
- [ ] 6.8 GREEN `src/modules/auth/forced-change.ts` — export
      `CHANGE_PASSWORD_PATH = "/change-password"` as the **single source of
      truth**, and `isPasswordChangeExempt()` checking against it plus the
      other two literal paths. No other file redeclares this path string.
- [ ] 6.9 RED `route-guards.test.ts` (extend) — asserts `/login`,
      `CHANGE_PASSWORD_PATH`, `/api/account/password`, and `/api/logout` are
      ALL pinned `"session-only"` in `ROUTE_GUARDS` — a test that fails if
      anyone later attaches an `Action` to any of the four, which the design
      calls out as an unrecoverable-lockout risk.
- [ ] 6.10 GREEN — register the four entries; re-run 2a's completeness test.
- [ ] 6.11 RED `proxy.test.ts` (new, or extend if a proxy test exists) — with
      `validateSession` mocked/injected: a flagged user (`mustChangePassword:
      true`) hitting a page route gets a 307 redirect to
      `CHANGE_PASSWORD_PATH`; hitting an `/api/**` route gets 403 JSON
      `{ error: "password_change_required" }`; hitting an exempt path passes
      through with `x-user-*` headers forwarded as today.
- [ ] 6.12 GREEN `src/proxy.ts` — add the `mustChangePassword` branch
      immediately after the existing `if (!user) redirect /login`, using
      `isPasswordChangeExempt()` from 6.8. **No revocation special case** —
      explicitly do not add a branch that revokes the current session on the
      forced path (design decision, stated to prevent a future "fix").
- [ ] 6.13 `src/app/(app)/change-password/page.tsx` — imports
      `CHANGE_PASSWORD_PATH`'s route (not a redeclared string) for its own
      route registration; renders the same `PasswordForm` from v1's WU5b,
      POSTing to the same `/api/account/password` (no new endpoint — reuses
      v1's route, extended here to add the `mustChangePassword`-clearing
      branch and the "new password differs from temporary" check that v1
      explicitly deferred — see WU5a.4's note).
- [ ] 6.14 Manual verification checklist (record in PR body): a freshly
      created user can reach only the change-password screen and logout, and
      is released the instant they change it; a deactivated user's open
      second browser is bounced to `/login` on their next click.

### Deferred Work Unit 7a — Admin User Mutations + Admin-Safety Guard

Target files: `src/modules/account/service.ts` (extend),
`src/modules/account/service.test.ts` (extend),
`src/modules/account/queries.ts` (extend), `src/modules/account/queries.test.ts`.

- [ ] 7a.1 RED `service.test.ts` — `checkAdminSafety()` truth table: self
      role-change → `"self_role_change"`; self-deactivate →
      `"self_deactivate"`; last active admin (deactivate or demote) →
      `"last_active_admin"`; an already-deactivated admin excluded from the
      active-admin floor count; demoting an already-deactivated admin is a
      no-op for the count (returns `null`); two active admins remain → `null`
      (allowed).
- [ ] 7a.2 RED `service.test.ts` — **concurrency test**: simulate two
      concurrent `deactivateUser` calls against the last two active admins by
      asserting the count-read and the write happen inside **one
      `db.transaction()`** call (inject a fake `db` that records call order;
      assert the transaction wrapper is used, not two independent
      queries) — this is the explicit guard against the race the design
      calls out.
- [ ] 7a.3 GREEN `checkAdminSafety()` (pure function, design Decision 7) +
      a transactional wrapper (e.g. `deactivateUserSafely`) that reads
      `activeAdminIds` and performs the write inside the same
      `db.transaction()`.
- [ ] 7a.4 RED `service.test.ts` — `createUser()`: sets
      `mustChangePassword = true` unconditionally; duplicate `username`/`email`
      → 409-shaped error (reuse `DuplicatePhoneError`-style pattern).
      `updateUser()`: edits `name`/`email`/`role`; role change does not touch
      sessions. `resetPassword()`: sets a new hash AND
      `mustChangePassword = true` regardless of prior value, calls
      `revokeOtherSessions(targetId, null)`. `deactivateUser()`: sets
      `deactivatedAt`, calls `revokeOtherSessions(targetId, null)`, runs
      through `checkAdminSafety` first. `reactivateUser()`: clears
      `deactivatedAt`.
- [ ] 7a.5 GREEN — implement all five functions in `service.ts`.
- [ ] 7a.6 RED `queries.test.ts` — `listUsers({ includeInactive: boolean })`
      defaults to active-only (Round 4 decision #1 — see the reconciliation
      note above); `includeInactive: true` returns both, inactive rows
      flagged.
- [ ] 7a.7 GREEN `queries.ts` — `listUsers`, `getUserById`.

### Deferred Work Unit 7b — User Management Routes

Target files: `src/app/api/users/route.ts` (+ test),
`src/app/api/users/[id]/route.ts` (+ test).

- [ ] 7b.1 RED `users/route.test.ts` — `GET` (list, `?includeInactive=`
      passthrough) and `POST` (create) both gated `users.manage`; técnico
      gets 403 on both, no business logic runs.
- [ ] 7b.2 GREEN `users/route.ts`.
- [ ] 7b.3 RED `users/[id]/route.test.ts` — `PATCH` branches on request shape
      to call `updateUser`/`resetPassword`/`deactivateUser`/`reactivateUser`;
      each `checkAdminSafety` rejection surfaces as a 400 with the specific
      reason string, not a generic error.
- [ ] 7b.4 GREEN `users/[id]/route.ts`; register both routes in
      `ROUTE_GUARDS`.

### Deferred Work Unit 7c — User Management Page

Target files: `src/app/(app)/users/page.tsx`,
`src/modules/account/UserForm.tsx`, `src/modules/account/UserFormTrigger.tsx`.
Also: add the third `Configuración` child ("Gestión de usuarios",
`users.manage`) to `nav-items.ts` here — this is where v1's WU4a.3
explicitly deferred it to.

- [ ] 7c.1 `UserForm.tsx` — create/edit dialog mirroring `CustomerForm.tsx`;
      create mode requires `username`+`role`+initial password (same
      validation rules as self-service password change per Round 4 decision
      #2); edit mode allows `name`/`email`/`role` and an optional
      password-reset field.
- [ ] 7c.2 `UserFormTrigger.tsx` — owns `useRouter()`, `onSaved={() =>
      router.refresh()}`, same pattern as `CustomerFormTrigger.tsx`.
- [ ] 7c.3 `users/page.tsx` — list defaults to **active users only** with a
      "Mostrar inactivos" toggle (Round 4 decision #1, see reconciliation
      note above); inactive rows render greyed with a "Reactivar" action
      instead of "Desactivar"; admin-only fallback UI matching
      `template-config/page.tsx`; register in `ROUTE_GUARDS`.
- [ ] 7c.4 Add the "Gestión de usuarios" child to `Configuración` in
      `nav-items.ts` (gated `users.manage`) and extend `nav-items.test.ts`'s
      exact-tree assertions from two children to three. Manual verification:
      the nav entry now resolves instead of not existing.

### Deferred estimates

| Work unit | Lines | Files |
|---|---|---|
| 6 — Deactivation + forced-change enforcement | ~355 | 13 |
| 7a — Admin mutations + admin-safety guard | ~370 | 4 |
| 7b — User management routes | ~260 | 4 |
| 7c — User management page (+ 3rd nav child) | ~190 | 3 |
| **Deferred total** | **~1,175** | **~24** |

Pre-declared split note carried over: this was a single ~820-line unit before
splitting into 7a (pure logic)/7b (routes)/7c (page+forms) — same reasoning
as v1's other splits, re-verify against whatever v1 actually merged before
reusing these estimates unchanged.

---

## Key estimates — v1 only

| Work unit | Lines | Files |
|---|---|---|
| 1 — Schema + migration | ~270 | 10 |
| 2a — Policy + guard + registry framework | ~315 | 7 |
| 2b — Wire all routes/pages | ~265 | 19 |
| 3a — Workshop service + logo + R2 | ~353 | 6 |
| 3b — Workshop routes | ~310 | 4 |
| 3c — Workshop page + form | ~160 | 3 |
| 4a — Nav data model (two-child Configuración) | ~260 | 2 |
| 4b — Sidebar rendering + layout wiring | ~300 | 5 |
| 5a — Account service logic | ~280 | 4 |
| 5b — Account routes + page | ~390 | 7 |
| **v1 Total** | **~2,913** | **~54** |

Deferred total (see above): **~1,175 lines, ~24 files**. Combined original
scope: **~4,088 lines, ~91 files** (unchanged from the pre-cut forecast — the
cut only changes what ships in *this* change, not the total planned work).
