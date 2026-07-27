# Proposal: crm-shell-settings-rbac

## Intent

The app grew from a catalog generator into a workshop tool, but its shell never caught up. Today the sidebar is a flat list of six unrelated links, the header hardcodes "Dforce / Catálogos", the user button says "Administrador" to everyone regardless of who is logged in, and there is nowhere to configure the workshop itself. Worse, `can()` is **default-allow**: customers, service orders and catalog generation are open to any authenticated user, so "Técnico de taller" does not exist as a real permission tier — it is a label on a role that can do everything an admin can do except three actions.

**Success looks like**: a técnico logs in, sees their own name and role in the sidebar, navigates a grouped IA (CRM / Catálogo / Configuración), can work orders and read inventory, **cannot** generate catalogs, and the admin can set the workshop's logo and name so the shell renders the workshop's identity instead of a hardcoded string.

## What Changes

### 1. Sidebar information architecture

Rewire the flat `NavLink[]` into a grouped/nested model. shadcn's `SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupContent`, `SidebarMenuSub*` primitives already exist in `src/components/ui/sidebar.tsx` (lines 382-717) and are unused — this is wiring, not new component work.

| Group | Items |
|---|---|
| `CRM` | Clientes, Órdenes de servicio, Inventario |
| `Catálogo` | Generar Catálogos, Catálogos Generados |
| `Configuración` (pinned bottom, **above** the user button) | Config. del CRM, Config. de catálogos → *Configuración de template* (nested submenu) |

Copy convention verified against the real `nav-items.ts`: labels are already Spanish. Three labels are renamed (`Generar Catálogo` → `Generar Catálogos`, `Catálogos` → `Catálogos Generados`, `Configuración de Template` → `Configuración de template`); `sdd-spec` must pin the exact strings.

### 2. Workshop settings — "Config. del CRM"

New `workshop_config` singleton table, cloned from the `template_config` pattern (`id = "singleton"`, `onConflictDoUpdate`, no history — see `src/modules/template-config/service.ts`).

- **v1 fields: `logo_url` + `name` only.**
- Logo is a **real upload to R2** (binding decision), reusing `src/modules/catalog-storage/r2.ts`. `putObject` hardcodes `ContentType: "application/pdf"` (line 31) — generalize to a parameter, defaulting to the current value so no caller changes.
- The settings page is built as a **sectioned form** so business hours and information sources become additional sections + additional nullable columns later, with no restructuring. They are **not** built now (see Out of Scope).

### 3. Shell aesthetics + account settings

- `SidebarHeader` renders `workshop_config.logo_url` + `.name`, fetched in `src/app/(app)/layout.tsx` alongside `getNavItems`. Fallback when unset: current `GalleryVerticalEnd` icon + "Dforce / Catálogos".
- The footer button stops lying. Today it prints the role twice (`app-sidebar.tsx` lines 96-100). It becomes **name on top, role label underneath**. `users` has no `name` and no `email` today — both are added (see Migration).
- That button opens **account settings** (`/account`): view profile, edit `name` / `email` / password. `username` stays immutable in v1 (it is the login credential).
- **Session invalidation on password change is IN SCOPE.** Rationale: we are the ones shipping the password-change flow, so shipping it without revocation would be *creating* the gap, not inheriting it — and the machinery already exists (`sessions.revokedAt`, already used by logout). On password change, revoke every session for that user except the current one. Email change does **not** revoke: sessions are keyed by `userId`, not by credentials.

### 4. Role matrix, enforced

Static declarative matrix in `src/modules/auth/policy.ts` — a typed `Record<Role, ReadonlySet<Action>>` replacing the `ADMIN_ONLY_ACTIONS` allow-list, with `can()` flipping to **default-deny**. No DB-backed `role_permissions` table (binding decision).

| Capability | Administrador | Técnico de taller |
|---|---|---|
| Service orders | read + write | read + write |
| Customers | read + write | read + write |
| Inventory | read | **read only** |
| Catalogs list/download | yes | yes |
| Catalogs **generate** | yes | **no** (breaking) |
| Manual sync, template config, workshop config, `catalogs.listAll` | yes | no |

Gates must be added to routes/pages that have **none** today: `/api/customers`, `/api/customers/[id]`, `/api/service-orders`, `/api/service-orders/[id]`, `/api/catalog-builder/products`, `/api/catalog-builder/generate`, `/api/catalog-builder/queue-depth`, and their `(app)/` pages.

## Out of Scope

- **Business hours and information sources** in workshop settings — deferred by design. The area is *shaped* for them (sectioned form + nullable-column-friendly singleton table); building them now would double slice 3 without a settled spec.
- Multi-workshop / tenancy. Confirmed single-workshop; no tenant table, no tenant env.
- DB-backed / admin-editable permissions (`role_permissions`). Revisit only when someone asks to change permissions without a deploy.
- User-management UI: creating, inviting, deactivating users, or an admin editing someone else's role/email.
- Avatar upload, email verification, password reset / forgot-password, 2FA, audit log.
- Editing `username`.
- Sharing one logo asset between the sidebar and `template_config.logoUrl` (PDF branding). They stay independent in v1.
- Promoting these specs into an `openspec/specs/` tree (none exists in this repo yet).
- Any E2E run. Unit/integration only (`npm test`).

## Breaking Changes / Migration

### Role enum — **rename, do not add**

Recommendation: `ALTER TYPE "public"."role" RENAME VALUE 'usuario' TO 'tecnico'`, ending at a two-value enum `tecnico | administrador`.

| Why | Detail |
|---|---|
| The matrix has exactly two roles | Adding `tecnico` as a third value leaves `usuario` alive with real rows in it and no matrix entry — under default-deny those users would be locked out of everything. |
| Zero backfill | `RENAME VALUE` mutates the enum member in place; every existing `usuario` row *is* a `tecnico` row afterwards. No `UPDATE`, no window where rows hold a role the matrix doesn't know. |
| Sidesteps the `ADD VALUE` caveat entirely | The Postgres restriction is specific to `ADD VALUE`: the new value cannot be *used* in the transaction that added it. `scripts/migrate.mjs` uses Drizzle's node-postgres migrator, which runs each file in a transaction — so "add `tecnico`, then `UPDATE users SET role='tecnico'`" in one file would fail. `RENAME VALUE` carries no such restriction. |
| Correction to the exploration | This repo has **never actually applied** an `ALTER TYPE ... ADD VALUE`. `0006_add_opted_out_reminder_status.sql` was *deleted* at merge time and collapsed into `0006_shiny_dazzler.sql`'s `CREATE TYPE` (see `crm-workshop-management/tasks.md` lines 3-17). The precedent is an *avoided* `ADD VALUE`, not a proven one. |

Write the migration **by hand** — `drizzle-kit generate` cannot reliably infer an enum-value rename (it emits a drop/recreate or an interactive prompt). Precedent: `0004_stock_to_real.sql` is hand-authored. Same file also needs `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'tecnico'`.

Enum value stays ASCII (`tecnico`); the accented UI label "Técnico de taller" is a display mapping, not a DB value.

Callers to update with the rename: `scripts/seed-user.mjs` (lines 9-17), `src/shared/db/schema.test.ts`, `src/e2e/full-flow.e2e.test.ts` type literals, `README.md`. `STACK.md` also documents the old roles — and is already stale on other points; correcting it is optional, not gating.

### New `users` columns

`name text` (nullable), `email text` (nullable, unique — Postgres unique permits multiple NULLs, so no partial index needed).

Backfill story: the migration runs `UPDATE users SET name = username WHERE name IS NULL`, so no existing seeded user renders a blank sidebar footer. `email` stays NULL until the user fills it in; the account form treats it as optional. Both stay nullable — making them `NOT NULL` would require inventing data for seeded/demo users.

### Default-allow → default-deny

This is the highest-risk part of the change. What could silently break:

| Failure mode | Why it is dangerous |
|---|---|
| A route/page that needs an action never gets a `can()` call | Not a break — it stays open. This is the *silent* one: the matrix looks enforced but isn't. |
| An `Action` exists in the union but is assigned to no role | Every caller 403s, including the admin. Loud but easy to ship if untested. |
| `nav-items.ts` filters by `can()` | A missing/denied action makes a nav item **vanish with no error**. Worst UX failure mode: not a 403 page, just a missing link. |
| The E2E suite is the current regression net for the ungated routes | E2E must never be run here, so route-level unit tests have to carry that weight instead. |
| Técnico losing catalog generation | Intended, accepted, and *indistinguishable at runtime* from an accidental over-restriction. Must be asserted by a test, not eyeballed. |

How `sdd-tasks` must guard it:

1. Type the matrix as an exhaustive `Record<Role, ReadonlySet<Action>>` so adding an `Action` without assigning it to every role is a **compile error**.
2. Extend the existing `it.each` in `policy.test.ts` into a full cross-product: for every `Action` × every `Role`, assert an explicit expected boolean. A new action with no entry fails the suite.
3. Ship an explicit checklist task enumerating **every** route handler and page listed in §4 above, each mapped to its assigned action, checked off individually — not "add gates where needed".
4. Run `npm test` at the end of every slice, and treat a disappeared nav item as a test failure (`nav-items.test.ts` already exists — extend it per role).

## Capabilities

### New Capabilities
- `role-permissions`: two-role declarative matrix, default-deny `can()`, server-side enforcement across all routes/pages
- `workshop-settings`: `workshop_config` singleton (logo upload to R2 + workshop name), extensible settings area
- `user-account`: `users.name`/`users.email`, profile view/edit, password change with session revocation
- `app-navigation`: grouped/nested sidebar IA, config-driven header, identity-driven footer

### Modified Capabilities
- `catalog-generation`: generation becomes `administrador`-only (spec currently lives at `openspec/changes/adaptive-catalog-layouts/specs/catalog-generation/spec.md`)
- `customer-management`: explicitly gated by `can()` — reverses the v1 "no `can()` sub-gate" decision in `src/app/api/customers/route.ts` line 9
- `service-orders`: same — explicitly gated

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/shared/db/schema.ts` | Modified | role enum rename, `users.name`/`email`, `workshop_config` table |
| `src/shared/db/migrations/00xx_*.sql` | New | hand-written: `RENAME VALUE`, `SET DEFAULT`, columns + name backfill, new table |
| `src/modules/auth/policy.ts` | Modified | `Action` union widened, `Role`→actions matrix, default-deny |
| `src/modules/auth/session.ts` | Modified | `Role` type widening; `name` read via DB lookup, **not** a new proxy header |
| `src/proxy.ts` | Unchanged | keeps forwarding `x-user-id`/`x-user-role`; no new headers |
| `src/modules/layout/nav-items.ts` | Modified | flat `NavLink[]` → grouped/nested model, per-role gating |
| `src/components/app-sidebar.tsx` | Modified | groups, nested submenu, bottom-pinned Configuración, config-driven header, name+role footer |
| `src/components/ui/sidebar.tsx` | Unchanged | primitives already present |
| `src/app/(app)/layout.tsx` | Modified | fetch workshop config alongside nav items |
| `src/modules/workshop-config/*` | New | service + validation + form, mirroring `template-config` |
| `src/modules/account/*`, `src/app/(app)/account/` | New | profile view/edit + password change |
| `src/modules/catalog-storage/r2.ts` | Modified | `putObject` content-type parameter |
| Ungated routes/pages from §4 | Modified | add `can()` gates |
| `scripts/seed-user.mjs`, `README.md` | Modified | `usuario` → `tecnico` |

## Slicing Plan

`chained-pr` gate: forecast ~1,570 changed lines — **`400-line budget risk: High`, `Chained PRs recommended: Yes`**. Strategy: **feature-branch-chain** with a draft tracker PR, matching this project's precedent on `crm-workshop-management` (7 PRs) and `adaptive-catalog-layouts`. Rationale: schema-migration-heavy and the RBAC flip must not reach `main` half-applied — a partially-landed matrix is a security state, not just an incomplete feature.

| PR | Work unit | Est. lines | Depends on |
|---|---|---|---|
| 1 | Schema + hand-written migration (enum rename, `users.name`/`email` + backfill, `workshop_config`), `schema.test.ts`, seed-user/README/e2e literals | ~180 | tracker |
| 2 | `policy.ts` matrix + default-deny, full cross-product policy tests, `can()` gates on every route/page from §4 (incl. admin-only generate) | ~320 | 1 |
| 3 | `workshop-config` module: singleton service + validation, `r2.putObject` content-type param, logo upload route, settings page + sectioned form | ~420 | 1 |
| 4 | Sidebar IA: grouped/nested `nav-items.ts` + per-role gating, `AppSidebar` groups/submenu/bottom-pinned Configuración, config-driven header with fallback, `(app)/layout.tsx` fetch | ~350 | 2, 3 |
| 5 | Account settings: `/account` page, profile view/edit, password change + session revocation, footer button wiring | ~300 | 1, 4 |

```
tracker (draft, no-merge)
  └── PR1 schema ──┬── PR2 rbac ──┐
                   └── PR3 settings ──┴── PR4 shell ── PR5 account
```

Order: **1 → (2 ‖ 3) → 4 → 5**. PR2 and PR3 are independent of each other and can be reviewed in parallel; PR4 needs both (it renders workshop config *and* gates nav by the matrix).

`sdd-tasks` must re-forecast precisely and be ready to split **PR3** (at ~420, already over budget) into 3a (service + validation + R2 + upload route) and 3b (page + form).

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Default-deny locks out a working flow, or worse, *looks* enforced but leaves a route open | High | The four guards in §Default-allow → default-deny: exhaustive typed matrix, cross-product tests, explicit per-route checklist, per-role nav tests |
| Hand-written enum-rename migration diverges from `schema.ts`, so future `drizzle-kit generate` emits a spurious diff | Medium | After PR1, run `drizzle-kit generate` and assert it produces **no** new migration; `schema.test.ts` asserts `roleEnum.enumValues` |
| PR3 exceeds the 400-line budget as specced | Medium | Pre-declared 3a/3b split point |
| First real file upload in the codebase — no precedent for size/type validation, multipart handling, or R2 failure UX | Medium | Validate type + size server-side before `putObject`; on upload failure keep the previous logo, surface a Spanish error, do not write a partial row |
| Técnicos lose catalog generation and read it as a bug | Medium | Intentional; the nav item disappears rather than 403s, and release notes must state it. Reversible by one line in the matrix |
| `STACK.md` is stale (wrong palette, wrong sidebar path) and misleads implementation | Medium | Already proven wrong; every slice verifies against real files. Do not cite `STACK.md` in design |
| Sidebar collapses to icon mode (`collapsible="icon"`) — grouped labels and nested submenus need a collapsed-state design | Medium | `sdd-design` must specify collapsed behaviour for group labels and the nested Configuración submenu, not just expanded |
| Revoking sessions on password change logs the user out of their own tab | Low | Explicitly preserve the current session token; assert it in a test |

## Rollback Plan

Per-slice, in reverse dependency order:

- **PR5 / PR4 / PR3**: revert the commit. Additive modules and UI only; the shell falls back to the hardcoded header and flat nav.
- **PR2**: revert `policy.ts` and the gate calls — `can()` returns to default-allow. This is the one slice where a partial revert is dangerous: reverting the matrix while leaving the gates in place 403s everything. Revert the whole slice or none of it.
- **PR1**: reverse migration is `ALTER TYPE "public"."role" RENAME VALUE 'tecnico' TO 'usuario'` + `SET DEFAULT 'usuario'` + `DROP COLUMN name/email` + `DROP TABLE workshop_config`. Data loss on rollback is limited to `name`/`email` values and workshop config — acceptable, no business records involved.

Because the tracker PR stays draft until every child is reviewed, `main` never sees a half-applied matrix.

## Dependencies

- Existing R2 bucket + credentials (`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`) — already configured for PDFs, reused for the logo. No new env vars expected; confirm the bucket's public-read policy suits an image served in the shell.
- A local `tecnico` user for manual verification — `scripts/seed-user.mjs` already accepts a role argument.

## Success Criteria

- [ ] Sidebar renders three groups (CRM / Catálogo / Configuración) with Configuración pinned above the user button and *Configuración de template* nested under Config. de catálogos
- [ ] Admin uploads a logo + sets a workshop name; both appear in the sidebar header after reload; a fresh DB with no config falls back cleanly
- [ ] Footer button shows the logged-in user's name (falling back to `username`) with their role label underneath, and opens `/account`
- [ ] A user edits their name/email and changes their password; other sessions are revoked, the current one survives
- [ ] A `tecnico` can read+write service orders and customers, read inventory, list+download catalogs, and receives 403 on `/api/catalog-builder/generate` with no "Generar Catálogos" nav item
- [ ] `policy.test.ts` asserts an explicit expected boolean for every `Action` × `Role` pair
- [ ] Existing `usuario` rows became `tecnico` with no data loss and no manual step
- [ ] `drizzle-kit generate` produces no new migration after PR1
- [ ] `npm test` green at the end of every slice; no E2E run
