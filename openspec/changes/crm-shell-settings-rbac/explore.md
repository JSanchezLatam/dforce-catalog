# Exploration — crm-shell-settings-rbac

## Exploration: crm-shell-settings-rbac

### Current State

**Shell / Sidebar** (`src/components/app-sidebar.tsx`, `src/modules/layout/nav-items.ts`)
- Flat list today, no grouping. `getNavItems(user)` returns `NavLink[]`, rendered as one `SidebarMenu`. shadcn's own `src/components/ui/sidebar.tsx` ALREADY exports `SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupContent`, `SidebarMenuSub`, `SidebarMenuSubItem`, `SidebarMenuSubButton` (lines 382-717) — unused today. Grouping/nesting is a wiring exercise on existing primitives, not new component work.
- Header hardcodes "Dforce"/"Catálogos" text (lines 51-54) — static, not config-driven.
- Footer `DropdownMenu` trigger shows an `Avatar` with a role-initial + role label twice (`user.role === "administrador" ? "Administrador" : "Usuario"`), no name shown (no name field exists — see roles below).
- No `ui-ux-modular-sidebar` change exists anywhere (Glob across repo/openspec found nothing, no git history reference). Treat that prompt claim as NOT FOUND — there is no prior groundwork beyond shadcn's stock (unused) primitives.
- Palette confirmed: shadcn stock tokens (`bg-primary`, `sidebar-accent`, `muted-foreground`) — zero `dash-*` classes in actual component code, matching the memory note that the old palette was superseded. STACK.md doc is stale/wrong here (still says "paleta dash-* v2" and wrong sidebar file path). Real light/dark toggle exists via `next-themes` (`ThemeToggle.tsx`).

**Auth / Roles** (`src/modules/auth/policy.ts`, `session.ts`, `src/shared/db/schema.ts`)
- `users` table: `id, username, passwordHash, role, createdAt`. `role` is `pgEnum("role", ["usuario","administrador"])` — only 2 values. NO `name`/`email`/`displayName` column exists.
- `can(user, action)` is a hand-rolled allow-list: `Action = "sync.manual" | "template.edit" | "catalogs.listAll"`, all 3 admin-only; everything else returns `true` for any authenticated user (no third tier exists today).
- Enforcement is real and consistent, not UI-only: `proxy.ts` (Next 16's renamed middleware) validates the opaque session token and forwards `x-user-id`/`x-user-role` headers; every gated route handler/Server Component calls `requireSession()` then `can()` before business logic. `nav-items.ts` reuses the same `can()` to hide the one gated nav item, so today's only gated UI element is also enforced server-side.
- `customers`/`service-orders` (crm-workshop-management) are explicitly NOT gated by `can()` (route.ts comment: "no can() sub-gate for v1, same as inventory-view") — any authenticated user has full read+write today.
- `/api/catalog-builder/generate` is also NOT admin-gated — any authenticated user can generate catalogs today.

**Gap vs requested matrix**: no "Técnico" tier exists at all today. The plain "usuario" role is already close to the described Técnico (full read/write on customers+orders, matches; read-only inventory for everyone, matches) EXCEPT catalogs: today anyone can GENERATE, but the requested matrix only grants Técnico "read + download" — this is a real behavior reduction, not just a label rename, and needs explicit confirmation.

**Inventory read-only inconsistency (flagged, not resolved)**: `/inventory` is visible/readable to ALL authenticated users today, but the requested sidebar IA (CRM group, Catálogo group, Configuración) does not list Inventario anywhere. The role matrix still grants Técnico inventory-read. Open question: is Inventario dropped from nav intentionally (access exists, just not surfaced) or should it become a 3rd nav item/subitem?

**Workshop settings persistence**
- Confirmed single-tenant/single-workshop: no tenant/workshop table anywhere in schema.ts, no tenant concept in env.ts, one Postgres per Docker deployment; `RESEND_FROM`'s own example comment assumes one workshop.
- Closest existing pattern: `templateConfig` — a singleton-row-no-history table (`id="singleton"`, upsert via `onConflictDoUpdate`) for catalog PDF branding (logoUrl as validated URL string, primaryColors, font, coverText). `TemplateConfigForm.tsx` is a plain `<Input>` for `logoUrl` — NO file upload flow exists anywhere in the codebase today. This singleton pattern is the direct template for a new workshop-settings table, and `/template-config` already maps 1:1 to the requested "Config. de catálogos → Configuración de template" nested nav node (existing feature, just needs to move under the new group).
- Reusing `catalog-storage/r2.ts` for a logo: `putObject(key, body)` hardcodes `ContentType: "application/pdf"` — needs a small param change to accept image content types, but the R2 client/bucket/env plumbing is otherwise directly reusable (Low effort, not a new module).

**Profile editing**
- No editable profile fields exist beyond `username`/password (bcrypt, cost 12, `password.ts`). No email/display-name column, no profile/account route/action anywhere in the codebase.
- Opaque sessions are keyed by `userId`, not credentials — a password change does not need to invalidate other sessions structurally, but note there is NO session-invalidation-on-password-change today; flag as a security gap to consider during design, not exploration-blocking.

### Affected Areas
- `src/components/app-sidebar.tsx` — grouped sections, nested Configuración, config-driven header, name+role footer.
- `src/modules/layout/nav-items.ts` — flat `NavLink[]` → grouped/nested shape; new gating for Técnico tier.
- `src/components/ui/sidebar.tsx` — no changes needed, `SidebarGroup`/`SidebarMenuSub` primitives already exist unused.
- `src/modules/auth/policy.ts` — needs a broader `Action` set + real 3-role matrix (not just an admin-only allow-list).
- `src/shared/db/schema.ts` — 3rd `roleEnum` value (additive `ALTER TYPE...ADD VALUE`, same pattern as `reminder_status`'s `opted_out` addition in migration 0006); `users.name`/`email` columns; new `workshop_config`-style singleton table mirroring `template_config`.
- `src/modules/auth/session.ts` — `SessionUser`/`Role` type widening; keep name/email as a DB lookup in Server Components rather than bloating forwarded proxy headers.
- `src/app/(app)/layout.tsx` — fetch workshop config alongside `getNavItems`.
- `src/app/api/customers/route.ts`, service-orders routes, `catalog-builder/generate/route.ts` — need NEW `can()` gates that don't exist today to actually enforce the matrix server-side.
- New: profile module + `/account`-style route; workshop-settings module + new settings routes.
- `scripts/seed-user.mjs` — likely needs a `--role` option for local técnico testing.

### Approaches — RBAC specifically

1. **Extend existing `can()` with a declarative role→permission matrix** (grow `policy.ts` in place)
   - Pros: zero new infra beyond the enum value; matches the codebase's own stated convention (`policy.ts` doc comment: "hand-rolled, no RBAC library... adding a role/action means editing only this file"); trivially unit-testable via the existing `it.each` pattern in `policy.test.ts`; zero runtime cost (pure function); one-file diff to review.
   - Cons: any permission change needs a code deploy; doesn't scale past a handful of roles or per-user overrides; doesn't carry forward if this ever becomes multi-tenant/per-workshop configurable.
   - Effort: Low.
2. **DB-backed `role_permissions` table**
   - Pros: admin-editable without a deploy; natural fit for a future multi-tenant/admin-configurable permission model; auditable.
   - Cons: directly contradicts this codebase's explicit documented decision ("no RBAC library... hand-rolled"); adds DB I/O (or a cache-invalidation problem) to `can()`, which today is synchronous/pure and called inside Server Components and route handlers; over-engineered for a matrix the user described as "supongo hay que generarla" (static, not "must be admin-editable").
   - Effort: Medium-High.

**Recommendation**: Approach 1. The request is a fixed 3-role matrix, not a runtime-configurable one, and the team already has a working, tested, server-enforced convention to extend. Approach 2 should be revisited only if a future requirement explicitly demands admin-editable permissions or per-workshop overrides — document that as a deliberate "not now," not a silent foreclosure.

### Scope / Slicing Signal (delivery_strategy = ask-on-risk, 400-line budget)

Precedent: `crm-workshop-management` was ~2,760 lines / 7 chained PRs (feature-branch-chain) for a comparable multi-concern change. Rough forecast for this change:

| Unit | Scope | Rough size |
|------|-------|------------|
| 1 | Schema: 3rd role value + `users.name`/`email` + workshop-config singleton table + migration | ~150-200 lines |
| 2 | `policy.ts` matrix extension + tests + new route-handler gates (customers/service-orders/catalog-builder) | ~250-350 lines |
| 3 | Workshop-settings module (service+queries+form, logo storage wiring) + settings page | ~350-450 lines |
| 4 | Sidebar IA restructure (grouped/nested nav-items, config-driven header+footer) | ~300-400 lines |
| 5 | Profile module (view/edit name+email+password) + account page | ~250-350 lines |

Estimated total ~1,300-1,800 lines across 5 units — likely High risk on the 400-line budget as one PR. Recommend a chained-PR split (schema → RBAC → workshop-settings → shell/nav → profile), mirroring this project's established feature-branch-chain precedent. Treat these numbers as exploration-stage rough estimates only — re-forecast precisely at sdd-tasks time.

### Risks
- `ALTER TYPE ... ADD VALUE` for the role enum has known Postgres transaction-boundary caveats already navigated once for `reminder_status`'s `opted_out` addition — re-verify the same approach applies to `role`.
- Making catalog generation Técnico-restricted is an access REDUCTION from today's default-allow — needs explicit user confirmation before implementation (not implied by "supongo hay que generarla").
- New `users.name`/`email` columns will be blank for existing seeded/demo users until manually filled — decide a fallback display for the shell footer during the transition.
- No session invalidation on password change exists today; don't assume it's already handled when building profile editing.
- STACK.md is stale/inaccurate (wrong palette claim, wrong sidebar file path) — verify per-file during design/apply, don't trust it as ground truth.

### Open Questions (answer before proposal — each changes the design materially)
1. Catalog generation for Técnico: does "catalogs: read + download" mean Técnico LOSES today's generate access (breaking change) — or should generate stay allowed and the matrix wording was shorthand?
2. Inventory nav placement: matrix grants Técnico inventory-read, but the requested IA has no Inventario item anywhere. Should it become a nav item/subitem, or is dropping it from nav (while access still exists) intentional?
3. RBAC approach sign-off: confirm Approach 1 (extend `can()` in-file, no DB-backed table) is acceptable given the matrix is static — or is admin-editable permissions actually needed soon (which would justify Approach 2 now)?
4. Logo storage: reuse R2 (requires generalizing `putObject`'s hardcoded PDF content-type) or keep it simple like `template_config.logoUrl` (plain URL input, no real upload) for v1?
5. Workshop-settings v1 scope: confirm "logo + name" truly is the full v1 slice with everything else (business hours, info sources) explicitly deferred in the design doc — or should the table be shaped now with extra nullable columns to avoid a second migration later?

### Ready for Proposal
Yes, with caveats. Codebase investigation is complete on every "verify before assuming" point (single-tenant confirmed, no ui-ux-modular-sidebar prior art found, shadcn stock palette + real light/dark toggle confirmed, existing can()/role shape read directly, template_config singleton pattern identified as reusable). Recommend the orchestrator get answers to Open Questions #1-#3 (breaking-change risk, nav IA, and RBAC architecture choice) from the user before sdd-propose locks in an approach, rather than defaulting silently.
