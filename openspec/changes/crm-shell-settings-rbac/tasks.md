# Tasks: crm-shell-settings-rbac

## Scope boundary — read this before implementing anything

**v1 ships** work units 1 through 5b (all 10 units, ~2,913 lines).
**Deferred to a separate SDD follow-up change** (NEVER in this PR chain): work
units 6, 7a, 7b, 7c — deactivation enforcement, `must_change_password`
forced-change flow, and the admin user-management CRUD screen.

**Consequence for the specs**: `specs/user-management/spec.md` and the
forced-password-change requirements in `specs/user-account/spec.md` describe
deferred behavior. `verify` MUST NOT treat them as v1 acceptance criteria.
Each v1 spec already has a "Deferred" section header at the bottom of its
file — refer to those when asked.

**No "Gestión de usuarios" item exists in the v1 nav** — not commented out,
not gated-and-hidden; the item simply does not exist in
`src/modules/layout/nav-items.ts` until the follow-up change adds it.

**NO `reactivate`/`deactivate` routes, logic, or toggle UI exist in v1.**
The design's "two-step activation" flow and all related copy are deferred.

## Review Workload Forecast

Generated after tasks phase — this is the review-workload guard's input.

| Metric | Value |
|--------|-------|
| Total v1 changed lines (forecast) | ~2,913 |
| Total v1 files | ~54 |
| Work units | 10 |
| 400-line budget risk | MEDIUM — WU5b at ~390 (split pre-declared) |
| Chained PRs recommended | Yes — tracks main via feature branch chain |
| Decision needed before apply | Yes — coordinator must confirm chain strategy |

**Chain strategy**: `feature-branch-chain` — tracker branch
`feature/crm-shell-settings-rbac` accumulates the full feature; PR #1 targets
the tracker; each child PR targets the immediately previous PR branch so
review diffs stay focused; ONLY the tracker merges to main.

---

## Work Unit 1 — Schema + Migration

Target files: `src/shared/db/schema.ts` (add `workshop_config` table, add
`name`/`email`/`deactivatedAt`/`mustChangePassword` columns to `users`,
rename `roleEnum` value from `usuario` to `tecnico`),
`scripts/seed-user.mjs` (use `tecnico`), migration file.

**⚠️ Must land FIRST and ALONE** because every subsequent unit imports the
new column names and enums. If this unit is not the first PR in the chain,
every other PR diff includes schema churn.

**Users table changes** (`deactivatedAt`, `mustChangePassword`) are RESERVED
columns — inert in v1. No code path reads or writes them. They ship here
solely to avoid a migration-number collision with the follow-up change.

- [x] 1.1 RED `schema.test.ts` — `workshopConfig` table: `id` text PK
      default `'singleton'`, `name` text nullable, `logoR2Key` text nullable,
      `logoContentType` text nullable, `updatedAt` timestamp notNull default
      now. `users`: `name` text nullable, `email` text nullable unique,
      `deactivatedAt` timestamp nullable, `mustChangePassword` boolean notNull
      default false. `roleEnum` → `tecnico` (not `usuario`).
- [x] 1.2 GREEN `schema.ts` — implement per spec.
- [x] 1.3 `scripts/seed-user.mjs` — change `role: "usuario"` to
      `role: "tecnico"`.
- [x] 1.4 Generate migration via `scripts/migrate.mjs` after starting the
      local PG with `docker compose up -d db`.
- [x] 1.5 Update any file outside this change that references `"usuario"`
      (grep the entire codebase — at minimum `InventoryStatsHeader.tsx`, the
      e2e test, and the seed script).

---

## Work Unit 2a — Policy Matrix + Guard + Registry Framework

Target files: `src/modules/auth/policy.ts` (rewrite),
`src/modules/auth/policy.test.ts`, `src/modules/auth/roles.ts` (keep — already
correct: `tecnico`), `src/modules/auth/route-guards.ts` (new). This unit is
the **forcing function**: it makes `can()` default-deny with a complete
action×role matrix, and sets up the `ROUTE_GUARDS` registry that every
subsequent WU extends.

- [x] 2a.1 RED `policy.test.ts` — default-deny matrix: every Action has an
      explicit true/false for every Role; `can()` returns false for an
      unknown role.
- [x] 2a.2 GREEN `policy.ts` — complete `MATRIX`, `can()` default-deny.
- [x] 2a.3 RED `route-guards.test.ts` — fs-enumerates every route.ts +
      page.tsx under `app/` and asserts one `ROUTE_GUARDS` entry exists per
      file (fails on this unit's first run for the existing non-admin-gated
      routes, passes once the registry is populated).
- [x] 2a.4 GREEN `route-guards.ts` — `ROUTE_GUARDS` map gating every
      existing route. (The 5 base routes + customers/service-orders get
      `session-only` or the appropriate existing action. Workshop-config
      routes are NOT added here — they belong to WU3b.)

---

## Work Unit 2b — Wire Every Route + Page to the Matrix

Target files: `src/middleware.ts` (or `src/proxy.ts` for pages — see
design.md), all existing route handlers.

Refactors every existing route handler to call `can(user, requiredAction)`
after `requireSession()`, returning 403 when denied. Also wires page
components (server components) to call `can()` before rendering admin-only
UI. Each handler's required Action matches its `ROUTE_GUARDS` entry.

- [x] 2b.1 Reroute the router: the pattern `authorize(action, request) → 403
      | null` is used in every API route (workshop-config, template-config,
      account, etc. use it). All existing API routes now gate with `can()`.
- [x] 2b.2 Page gates: `template-config/page.tsx`, `builder/page.tsx`
      filter by `can(user, action)` returning a restricted UI or fallback.

---

## Work Unit 3a — Workshop Config Service + Logo Validation + R2 Param

Target files: `src/modules/workshop-config/service.ts` (new),
`src/modules/workshop-config/service.test.ts`, `src/modules/workshop-config/logo.ts`
(new), `src/modules/workshop-config/logo.test.ts`,
`src/modules/catalog-storage/r2.ts` (add `contentType` param),
`src/shared/config/env.ts` (add `WORKSHOP_LOGO_R2_KEY_PREFIX` env var).

- [x] 3a.1 RED `logo.test.ts` — PNG, JPEG, WebP, SVG by magic bytes; 2MB
      raster limit; 512KB SVG limit; SVG sanitisation (script, foreignObject,
      event handlers, remote href/xlink:href, DOCTYPE, ENTITY, a/links);
      `detectWebP` helper.
- [x] 3a.2 GREEN `logo.ts` — per spec.
- [x] 3a.3 RED `service.test.ts` — `getWorkshopConfig` returns singleton or
      null; `saveWorkshopConfig` validates name (max 100 chars, null ok);
      `validateWorkshopConfigInput` pure.
- [x] 3a.4 GREEN `service.ts` — per spec.
- [x] 3a.5 Add `WORKSHOP_LOGO_R2_KEY_PREFIX` env var to `env.ts` (used by
      logo routes later, but the env var belongs in this atomic dependency).

---

## Work Unit 3b — Workshop Config Routes

Target files: `src/app/api/workshop-config/route.ts` (+ test),
`src/app/api/workshop-config/logo/route.ts` (+ test). Extends
`route-guards.ts` with the two new entries.

- [x] 3b.1 RED `workshop-config/route.test.ts` — `GET` returns current config
      or nulls when unsaved (gated `workshop.read`); `POST` validates+saves
      name only, gated `workshop.edit`, 403 for técnico.
- [x] 3b.2 GREEN `workshop-config/route.ts`.
- [x] 3b.3 RED `workshop-config/logo/route.test.ts` — multipart `POST`:
      accepts valid raster/SVG, rejects invalid per 3a's `logo.ts` cases,
      calls `putObject` then best-effort `deleteObject(previousKey)`; `DELETE`
      clears the stored key; `GET` streams bytes with `Content-Type` from the
      **stored** value (never `file.type`), `Content-Disposition: inline`,
      the `Content-Security-Policy: default-src 'none'; style-src
      'unsafe-inline'; sandbox` header, `X-Content-Type-Options: nosniff`,
      `Cache-Control: private, max-age=60` + `ETag` from `logoR2Key`. All
      three gated `workshop.edit` except `GET` (`workshop.read`, granted to
      both roles).
- [x] 3b.4 GREEN `workshop-config/logo/route.ts` per design Decision 4's
      pipeline diagram.
- [x] 3b.5 Register both routes in `ROUTE_GUARDS` (2a's fs-enumeration test
      will fail on this unit's new files otherwise).
- [x] 3b.6 **Verification task (not a code change)**: confirm the R2 bucket
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

- [x] 3c.1 `WorkshopConfigForm.tsx` — sectioned form (name field only in v1,
      shaped for future sections per design Decision 3), POSTs to 3b's JSON
      route, `FIELD_ERROR` pattern matching `TemplateConfigForm`.
- [x] 3c.2 `LogoUploadField.tsx` — multipart upload to 3b's logo route,
      client-side preview, explicit copy stating the logo saves immediately
      on upload (before the text form's "Guardar" — accepted cost per design
      Decision 4).
- [x] 3c.3 `workshop-config/page.tsx` — "Config. del CRM", admin-only fallback
      UI matching the `template-config/page.tsx` pattern; register in
      `ROUTE_GUARDS`.

---

## Work Unit 4a — Nav Data Model (two-child `Configuración`)

Target files: `src/modules/layout/nav-items.ts` (rewrite),
`src/modules/layout/nav-items.test.ts` (rewrite).

- [x] 4a.1 RED `nav-items.test.ts` — asserts the **exact** group/label tree
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
- [x] 4a.2 GREEN `nav-items.ts` — `NavLink`/`NavParent`/`NavGroup` types per
      design Decision 5 (`children: readonly NavLink[]`, no third nesting
      level possible); `pinBottom?: boolean` explicit flag on the
      `Configuración` group, NOT derived from array position;
      `getNavGroups(user): NavGroup[]` filters by `can()` per item's optional
      `action`. **Do not add a "Gestión de usuarios" entry at all in v1** —
      not commented out, not gated-and-hidden; the item simply does not exist
      in this file until the follow-up change adds it.
- [x] 4a.3 Explicit task — **`Configuración` permanently ships with two
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
`src/modules/account/queries.ts` (new, minimal),
`src/modules/account/queries.test.ts`.

- [x] 4b.1 RED `queries.test.ts` — `getUserProfile(userId)` returns
      `{ username, name, email, role }` or throws/returns null for an unknown
      id (DI query seam, same convention as `customers/queries.ts`).
- [x] 4b.2 GREEN `src/modules/account/queries.ts` — implement just this one
      read function now (WU5a adds the rest of the account module later).
- [x] 4b.3 `WorkshopLogo.tsx` (client) — `<img src={"/api/workshop-config/logo?v="+version}>` inside the existing fixed `size-8 rounded-lg`
      box; `onError` and no-`logoR2Key` both fall back to `GalleryVerticalEnd`;
      reserves its space unconditionally (no layout shift).
- [x] 4b.4 `app-sidebar.tsx` rewrite: render `NavGroup[]` with
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
- [x] 4b.5 `layout.tsx` — fetch `getUserProfile(user.id)`,
      `getWorkshopConfig()` (React `cache()`-wrapped per design), and
      `getNavGroups(user)`; pass all three into `AppSidebar`.
- [x] 4b.6 Manual verification checklist (record in PR body, not automated —
      async RSC + real browser needed): keyboard-only reachability of
      "Configuración de template" when collapsed (Tab → trigger → `Enter` →
      arrow keys → `Escape` → focus returns to trigger); logo appears with no
      layout shift on slow network.

---

## Work Unit 5a — Account Service Logic

Target files: `src/modules/account/service.ts` (new),
`src/modules/account/service.test.ts`, `src/modules/auth/session.ts` (add
`revokeOtherSessions`), `src/modules/auth/session.test.ts`.

- [x] 5a.1 RED `session.test.ts` — `revokeOtherSessions(userId, keepTokenId)`
      sets `revoked_at = now()` for every session of `userId` except
      `keepTokenId`; `keepTokenId = null` revokes all.
- [x] 5a.2 GREEN `session.ts` — implement per design's SQL shape
      (`WHERE user_id = $1 AND revoked_at IS NULL AND ($2 IS NULL OR id <>
      $2)`).
- [x] 5a.3 RED `service.test.ts` — `updateProfile()`: persists `name`/`email`;
      ignores a submitted `username` change (spec: "MUST be ignored", not
      rejected); email format validation; duplicate-email → 409-style error,
      EXCEPT when the email is unchanged from the user's own current value
      (explicit "unchanged own email not flagged as duplicate" test case).
- [x] 5a.4 RED `service.test.ts` — `changePassword()`: wrong
      `currentPassword` → rejection AND **no hash write** (assert the mock
      DB update was never called, not just that the response is an error);
      correct password → hash updated, `revokeOtherSessions(userId,
      keepTokenId)` called. **v1 scope note**: do NOT implement the
      `mustChangePassword`-clearing branch here — that flag and its clearing
      rule belong to the deferred forced-change flow (WU6, follow-up
      change). `changePassword()` in v1 only ever handles a voluntary,
      self-initiated change.
- [x] 5a.5 GREEN `service.ts` — implement `updateProfile`, `changePassword`
      satisfying 5a.3-5a.4.

---

## Work Unit 5b — Account Routes + Page

Target files: `src/app/api/account/route.ts` (+ test),
`src/app/api/account/password/route.ts` (+ test),
`src/app/(app)/account/page.tsx`, `src/modules/account/ProfileForm.tsx`,
`src/modules/account/PasswordForm.tsx`.

- [x] 5b.1 RED `account/route.test.ts` — `GET` returns own profile; `PATCH`
      calls `updateProfile`, 400 on validation errors, 409 on duplicate email.
- [x] 5b.2 GREEN `account/route.ts`.
- [x] 5b.3 RED `account/password/route.test.ts` — `POST` calls
      `changePassword`; 400 + no-hash-write on wrong current password;
      success revokes other sessions (assert via injected deps, no DB).
- [x] 5b.4 GREEN `account/password/route.ts`; register both new routes in
      `ROUTE_GUARDS` gated `account.self` (both roles: true).
- [x] 5b.5 `ProfileForm.tsx` — `username` shown read-only, `name`/`email`
      editable.
- [x] 5b.6 `PasswordForm.tsx` — current/new/confirm fields, explains
      "other sessions will be signed out" copy.
- [x] 5b.7 `account/page.tsx` — mounts both forms, fetches via 5b.1's `GET`.

---

## Deferred to follow-up change

The following work units are explicitly DEFERRED. They are documented here
for the follow-up change's planning, NOT for v1 implementation.

### Work Unit 6 — Deactivation Enforcement

- [ ] 6.1...
- [ ] 6.2...

### Work Unit 7a — Admin User Management Routes

- [ ] 7a.1...
- [ ] 7a.2...

### Work Unit 7b — Admin User Management Page

- [ ] 7b.1...
- [ ] 7b.2...

### Work Unit 7c — Must-Change-Password Flow

- [ ] 7c.1...
- [ ] 7c.2...

## Key estimates — v1 only
