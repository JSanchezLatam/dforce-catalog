# Design: crm-shell-settings-rbac

## Technical Approach

Five seams, all already present in the codebase, get widened — no new architectural layer:

1. `src/modules/auth/policy.ts` becomes a **total** role×action map and `can()` flips to default-deny.
2. `src/modules/layout/nav-items.ts` returns grouped/nested links whose visibility keys off the same `Action` union.
3. `src/components/app-sidebar.tsx` wires the already-exported-but-unused `SidebarGroup*`/`SidebarMenuSub*` primitives (`src/components/ui/sidebar.tsx` 382-696) — `sidebar.tsx` is NOT modified.
4. A new `src/modules/workshop-config/` module clones the `template-config` singleton pattern and owns the logo bytes.
5. A new `src/modules/account/` module owns self-service profile/password and admin user management.

`src/modules/auth/session.ts` gains `name`-free identity as today; display name comes from a DB lookup in `src/app/(app)/layout.tsx`.

**Amended**: `src/proxy.ts` was originally scoped as unchanged. Binding decision #11 (forced password change) requires an interception there — see Decision 8. It remains the only transport-layer edit, and the predicate it calls lives in `src/modules/auth/` so it stays unit-testable. Decisions 7 and 8 also add a sixth and seventh rollout step; the account-state and forced-change checks deliberately land in `validateSession()` rather than in `can()`, because the matrix gates by role and must not become a runtime state machine.

---

## Decision 1 — Permission matrix shape

### 1a. The matrix type

**Choice**: a doubly-mapped total record, NOT a set.

```ts
// src/modules/auth/roles.ts   (new — Role + labels + guard co-located)
export type Role = "tecnico" | "administrador";
export const ROLES = ["tecnico", "administrador"] as const;
export const ROLE_LABELS: Record<Role, string> = {
  tecnico: "Técnico de taller",
  administrador: "Administrador",
};
export function isRole(value: unknown): value is Role { /* ROLES.includes */ }

// src/modules/auth/policy.ts
export const ACTIONS = [
  "customers.read", "customers.write",
  "orders.read", "orders.write",
  "inventory.read",
  "sync.manual",
  "catalogs.read", "catalogs.listAll", "catalogs.generate",
  "template.edit",
  "workshop.read", "workshop.edit",
  "users.manage",
] as const;
export type Action = (typeof ACTIONS)[number];

type Grants = { readonly [A in Action]: boolean };          // TOTAL, not a subset
const MATRIX: { readonly [R in Role]: Grants } = { administrador: {…}, tecnico: {…} };

export function can(user: { role: Role }, action: Action): boolean {
  const grants = MATRIX[user.role as Role];
  return grants ? grants[action] === true : false;          // unknown role -> deny, never throw
}
```

**Rationale**: the mapped type `{ [A in Action]: boolean }` makes adding a member to `ACTIONS` a **TS2739 missing-property error in every role object**. It also kills the proposal's failure mode "an Action assigned to no role": there is no "unassigned" state, only an explicit `false`.

**Rejected — `Record<Role, ReadonlySet<Action>>`** (what the proposal specified): this does **not** compile-error on a missing action. `new Set<Action>([...])` happily accepts any subset, so a forgotten grant is a silent runtime deny — exactly the failure the proposal was trying to prevent. **This corrects the proposal.**

**Rejected — DB-backed `role_permissions`**: binding decision #3, and `can()` is synchronous inside Server Components today.

Precedent that the forcing function works here: `src/modules/inventory-view/InventoryStatsHeader.tsx:4` already declares `Record<SessionUser["role"], string>`, so the `usuario`→`tecnico` rename produces a compile error there on day one. That map gets deleted in favour of the shared `ROLE_LABELS`.

### 1b. Detecting a route that forgot its `can()` call — honest assessment

| Mechanism | Catches | Does NOT catch | Verdict |
|---|---|---|---|
| Custom ESLint rule | "handler doesn't call `can`" syntactically | anything about *which* action; needs a local plugin (`eslint.config.mjs` has zero custom-rule infra) | **Rejected** — high setup cost, weakest signal |
| `withAuthorization(action, handler)` wrapper | nothing by itself (bypassable by not using it) | — | **Adopted, but only as the mechanism the test asserts against** |
| Filesystem-enumerating registry test | a NEW route/page file with no declared guard | a registry entry declaring the *wrong* action | **Adopted — this is the real net** |

Concretely, `src/modules/auth/guard.ts`:

```ts
export function withAuthorization<T extends (req: NextRequest, ...rest: never[]) => Promise<NextResponse>>(
  action: Action, handler: T,
): T   // returns 403 JSON before invoking handler when can() is false
```

and `src/modules/auth/route-guards.test.ts` owns the single source of truth:

```ts
export const ROUTE_GUARDS: Record<string, Partial<Record<"GET"|"POST"|"PATCH"|"DELETE", Action | "session-only">>> = { … }
```

The test does three things:
1. `fs.readdirSync(src/app, { recursive: true })` (Node ≥20, no new dependency) → every `api/**/route.ts` and `(app)/**/page.tsx` MUST have a `ROUTE_GUARDS` entry, else fail with the path. **A new ungated route added six months from now fails `npm test`.**
2. For each API entry with an `Action`, import the module and invoke the method with forged `x-user-id`/`x-user-role: tecnico` headers; assert 403 whenever `MATRIX.tecnico[action] === false`. This runs DB-free because `withAuthorization` short-circuits before the handler body.
3. `expect(new Set(Object.values(ROUTE_GUARDS).flatMap(...)))` covers every `Action` that is route-reachable — an action defined but wired nowhere is reported.

**What it cannot catch** (state plainly, do not paper over): a registry entry that names the wrong action; Server Component `page.tsx` files, which cannot be invoked under vitest's `node` environment (async RSC + `headers()`) and therefore get registry-completeness only, never behavioural assertion; and a route that gates correctly but leaks data *inside* the handler (ownership checks like `catalogs/[id]/file/route.ts`'s `isOwner` remain hand-written and hand-tested).

`login`/`logout` are registered as `"session-only"` — an explicit opt-out that has to be written down, not a silent gap.

### 1c. Nav item with an unknown action

`NavLink.action?: Action`. A typo'd or removed action is a compile error at the literal, not a vanishing menu entry. Second net: `nav-items.test.ts` asserts the **exact** group/label tree for each role (extending its existing style), so an item that silently disappears turns the test red.

---

## Decision 2 — Role enum migration

**Choice**: let `drizzle-kit generate` produce `0007_*.sql` + `meta/0007_snapshot.json` + the journal entry, then hand-edit **only the SQL body**:

```sql
ALTER TYPE "public"."role" RENAME VALUE 'usuario' TO 'tecnico';
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'tecnico';
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" text;      -- drizzle-generated below this line
…
UPDATE "users" SET "name" = "username" WHERE "name" IS NULL;
```

**Rationale**: drizzle-kit cannot infer an enum-value *rename* (it emits a drop/recreate or prompts), but it CAN correctly emit the new `users` columns and `workshop_config`. Generating first keeps `meta/0007_snapshot.json` and `_journal.json` machine-authored and consistent with `schema.ts`, which is exactly what defends the proposal's "spurious future drizzle-kit diff" risk. Only the enum statements are hand-written — the same shape as the `0004_stock_to_real.sql` precedent (hand-authored SQL body, normal generated snapshot). The journal `tag` is free-form; if the file is renamed for readability, the journal tag must be renamed identically.

**Transaction safety — verified, not assumed**: `scripts/migrate.mjs` uses `drizzle-orm/node-postgres/migrator`, which wraps each migration file in one transaction and splits on `--> statement-breakpoint` (`breakpoints: true` in `_journal.json`). Postgres' "new value cannot be used in the transaction that added it" restriction applies **only to `ALTER TYPE … ADD VALUE`**. `RENAME VALUE` mutates an existing member in place and is fully transactional, so RENAME + `SET DEFAULT 'tecnico'` + the `UPDATE` coexist safely in one file.

**Rejected — `ADD VALUE 'tecnico'` + `UPDATE`**: fails inside the migrator's transaction, and leaves `usuario` alive in the enum with no `MATRIX` entry → under default-deny those rows become `can() === false` for everything. **Rejected — a bare hand-written file with a hand-edited snapshot JSON**: editing snapshot JSON by hand is the most likely source of future drift.

**Rollback** is a NEW forward migration `0008_role_tecnico_to_usuario.sql`, never a deletion of 0007 — drizzle records applied hashes, so removing an applied file leaves the DB ahead of the journal.

**Callers forced by the type system** (`Role` is exported and widely imported, so `tsc` performs the audit): `src/modules/auth/session.ts:11`, `policy.test.ts:7`, `nav-items.test.ts:8`, `InventoryStatsHeader.tsx:4-7`, `src/app/api/customers/route.test.ts:12` and the other route tests' forged headers. String-only, NOT type-checked, must be grepped: `scripts/seed-user.mjs:9,12,16-17`, `src/e2e/full-flow.e2e.test.ts:67-97`, `README.md:52`. `STACK.md` is already stale and is not a source of truth.

---

## Decision 3 — Workshop settings persistence

**Choice**: new module `src/modules/workshop-config/` (`service.ts`, `logo.ts`, `WorkshopConfigForm.tsx`, `LogoUploadField.tsx`) + a nullable-friendly singleton table.

```ts
export const workshopConfig = pgTable("workshop_config", {
  id: text("id").primaryKey(),                    // "singleton"
  name: text("name"),                             // nullable — see below
  logoR2Key: text("logo_r2_key"),
  logoContentType: text("logo_content_type"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

**Rationale for a new module, not extending `template-config`**: binding decision #6 makes workshop identity and PDF branding two independent branding choices. The repo's layout is capability-per-module (`customers/`, `service-orders/`, `catalog-storage/`); folding workshop identity into `template-config` would couple a shell concern to the PDF pipeline and force `catalog-builder/generate/route.ts` to read a table it does not care about. Service surface mirrors `template-config/service.ts` exactly: `SINGLETON_ID`, a pure `validateWorkshopConfigInput`, `getWorkshopConfig()` returning `null` when unsaved, `saveWorkshopConfig()` with `onConflictDoUpdate`.

**`name` is nullable**: the logo endpoint and the text form save independently (Decision 4), so either can be the first write. Also keeps the deferred business-hours/info-sources sections addable as more nullable columns with no second backfill.

**No `logoUrl` column** — only `logoR2Key`. `env.ts` documents `R2_PUBLIC_URL` as display-only/"never used to serve downloads directly", and `catalogs/[id]/file/route.ts` already streams bytes through the app. Storing no public URL means the raw bucket URL never reaches a browser, which removes the "direct navigation to a public SVG object" vector structurally rather than by header hygiene. `catalogs` storing both `r2Key` and `r2Url` is the pattern we deliberately narrow.

**Read-path caching**: wrap `getWorkshopConfig` in React `cache()` for per-request dedupe and accept one primary-key single-row SELECT per navigation in `src/app/(app)/layout.tsx`. **Rejected — `unstable_cache`/`"use cache"`**: introduces an invalidation obligation on every save, and this codebase has zero caching infrastructure to model it on. The cost is noise next to `proxy.ts`'s per-request session JOIN plus the layout's existing `requireSessionFromHeaders()`.

---

## Decision 4 — Logo upload to R2

**Transport**: `POST /api/workshop-config/logo` (`multipart/form-data`) + `DELETE` to clear, separate from the JSON `POST /api/workshop-config` for text fields.

**Rationale**: the codebase's mutation convention is Route Handler + client `fetch` (`/api/template-config`, `/api/customers`); the only Server Action is `loginAction`, and it exists specifically for `useActionState`. Route handlers also give us the `handleX(request, deps)` DI seam that every route test in this repo uses — a Server Action has no `Request` to forge headers on. Keeping the text form JSON means the sectioned form stays byte-for-byte the `TemplateConfigForm` pattern, and multipart parsing is quarantined in one small, fully-tested file.
**Rejected — one multipart endpoint for the whole form**: makes every future text-only section pay for multipart parsing. **Rejected — Server Action**: untestable at the established seam.
**Accepted cost**: the logo persists at upload time, before the user presses Guardar on the text section. UI copy must say so.

**Pipeline** (`src/modules/workshop-config/logo.ts`, pure and DB/R2-free):

```
File → size gate (file.size, then buffer.length as authority)
     → magic-byte sniff  PNG 89 50 4E 47 · JPEG FF D8 FF · WebP "RIFF"…"WEBP" · SVG "<?xml"|"<svg"
     → if SVG: reject on <script>|<foreignObject>|on*=|remote href/xlink:href|<!DOCTYPE|<!ENTITY|<a>
               then strip comments/<style @import>/non-local <use> and store the sanitized bytes
     → putObject(`workshop/logo-${crypto.randomUUID()}.${ext}`, buffer, contentType)
     → UPDATE row (key + contentType)
     → deleteObject(previousKey)   best-effort, failure ignored
```

Caps: raster ≤ 2 MB, SVG ≤ 512 KB. **Content type is echoed from our own allow-list, never from `file.type`.**

**Sanitizer honesty**: it is a deny-list over text, not an SVG parser. It is defense layer #2. The primary control is structural (binding decision #5): the logo is only ever rendered through `<img>`, where browsers do not execute SVG script, and the bytes are only ever served by a route that sandboxes them. **Rejected — adding `svgo`/`dompurify`+`jsdom`**: a real parser is the right call when uploaded SVG can be inlined; here it cannot be, so the supply-chain and bundle cost buys a third layer of a defense already covered twice. Residual risk accepted: an exotic vector may survive the regex, and only an authenticated administrador can upload at all. We **reject** (400) rather than silently strip dangerous constructs — an admin uploading a scripted SVG is compromised or confused, and both deserve a loud failure.

**Serving** — `GET /api/workshop-config/logo`, gated `workshop.read` (granted to both roles; the shell needs it):

| Header | Value | Why |
|---|---|---|
| `Content-Type` | stored `logoContentType` | never the client's claim |
| `Content-Disposition` | `inline; filename="logo.<ext>"` | header renders inline |
| `Content-Security-Policy` | `default-src 'none'; style-src 'unsafe-inline'; sandbox` | `sandbox` neutralizes script even on direct navigation |
| `X-Content-Type-Options` | `nosniff` | no MIME confusion |
| `Cache-Control` + `ETag` | `private, max-age=60`, ETag from `logoR2Key` | the sidebar requests this on every navigation |

`?v={updatedAt.getTime()}` on the `<img src>` plus a fresh UUID key per upload makes replacement cache-busting free. **Rejected — a fixed key `workshop/logo`**: overwrite-in-place leaves stale browser/CDN copies and makes "delete the old object" ambiguous.

**`r2.ts` generalization**: `putObject(key, body, contentType = "application/pdf")`. Defaulted third parameter ⇒ **zero diff outside `r2.ts`** for existing PDF callers. Rejected: a required parameter (touches the pdf-upload worker) and a separate `putImage()` (duplicates client + return-URL logic).

---

## Decision 5 — Sidebar structure

### Data model

```ts
export type NavLink = { href: string; label: string; icon: NavIconKey; action?: Action };
export type NavParent = NavLink & { children: readonly NavLink[] };   // exactly one level
export type NavGroup = {
  id: "crm" | "catalog" | "settings";
  label: string;
  pinBottom?: boolean;                                    // settings only
  items: readonly (NavLink | NavParent)[];                 // heterogeneous: leaves AND parents
};
export function getNavGroups(user: SessionUser): NavGroup[];
```

`children` typed as `NavLink[]` (no `children` field) makes a third nesting level a compile error. `action?: Action` omitted ⇒ visible to any authenticated user. Filtering rules: a denied parent is dropped **with** its children; a kept parent with zero surviving children still renders (it has its own `href`); a group with zero surviving items is dropped entirely so no empty `SidebarGroupLabel` is emitted.

**Binding decision #9** puts `Gestión de usuarios` (`/users`, gated `users.manage`) inside `Configuración`, so that group's `items` is now `[NavLink, NavParent, NavLink]` — a leaf, a parent-with-children, and a leaf. The union type already permits this; the two consequences to implement are that the filter must handle leaves and parents in the same array, and that the collapsed-state dropdown (below) wraps **only** the `NavParent`, leaving leaves as plain buttons.

Because all three `Configuración` items are admin-gated (`workshop.edit`, `template.edit`, `users.manage`), the empty-group rule means **the entire `Configuración` group disappears for técnico** — no special-casing needed, and técnico sees exactly two groups.

### Placement of `Configuración`

**Choice**: `pinBottom: true` in the group data, rendered as `className="mt-auto"` on that `SidebarGroup`. `SidebarContent` is already `flex min-h-0 flex-1 flex-col`, so `mt-auto` pins the group above the existing `SidebarSeparator` + `SidebarFooter`. Zero changes to `sidebar.tsx`.

**Why a data flag and not "the last group"**: for técnico the settings group is filtered out entirely, so `mt-auto` applied to `groups[groups.length - 1]` would bottom-pin **`Catálogo`** — visually wrong and role-dependent in a way no test would obviously catch. Hardcoding `mt-auto` to `id === "settings"` also silently does nothing for técnico, which is correct but implicit. A `pinBottom` flag makes "nothing is pinned when this group is absent" the explicit, tested behaviour.

**Rejected — putting it in `SidebarFooter`**: the footer is the identity slot; mixing nav links in muddles the two and, collapsed, produces an unreadable stack of icons under the avatar. Known limitation: with heavy overflow the group scrolls rather than staying pinned — acceptable at 3 groups / ~9 items.

### Collapsed (`collapsible="icon"`) behaviour — verified against `sidebar.tsx`

| Primitive | Collapsed class (real, from source) | Consequence | Design response |
|---|---|---|---|
| `SidebarGroupLabel` (line 403) | `-mt-8 opacity-0` | labels fade AND reclaim their space | nothing needed; groups degrade into icon clusters |
| adjacent groups | — | three clusters become visually indistinguishable | render a `SidebarSeparator` between groups (always, reads fine expanded too) |
| `SidebarMenuSub` (644), `SidebarMenuSubButton` (682) | `group-data-[collapsible=icon]:hidden` | **the nested "Configuración de template" becomes UNREACHABLE** | see below |
| `SidebarMenuButton` `tooltip` prop | `hidden={state !== "collapsed"}` | only label affordance when collapsed | every button must pass `tooltip={label}` (current code already does) |

**Choice for the submenu**: when `useSidebar().state === "collapsed"`, render the parent as a `DropdownMenu` (`side="right"`, already imported in `app-sidebar.tsx` for the footer) listing the parent plus its children; when expanded, render `SidebarMenuSub`. `app-sidebar.tsx` is already `"use client"`, so reading `useSidebar()` is free.
**Rejected — accept the hidden submenu**: silently removes a feature for admins who keep the rail collapsed; that is the exact class of bug this change exists to kill. **Rejected — flatten children to top-level icons when collapsed**: loses hierarchy and puts two near-identical Settings icons adjacent on the rail.
**Expanded submenu is always open** — `src/components/ui/` has no `collapsible.tsx` (verified), so there is no expand/collapse state to manage. Rejected adding a Collapsible primitive for a one-item submenu.

### Accessibility & interaction review of the collapsed rail

Reviewed against `ui-ux-pro-max`'s priority table (P1 Accessibility, P2 Touch & Interaction, P9 Navigation) and the Web Interface Guidelines. **The dropdown-on-collapsed choice is confirmed, with two revisions and one addition.**

| Check | Verified finding | Outcome |
|---|---|---|
| Keyboard navigation into a collapsed group | `DropdownMenu` gives focus trapping, arrow-key traversal, `Escape`-to-close and focus-return-to-trigger. `SidebarMenuSub` is a plain `<ul>` of anchors with no roving tabindex — you simply Tab through it. | **Confirms the choice** — the dropdown is a keyboard *improvement* over the expanded submenu, not merely a workaround |
| Trigger semantics | A `DropdownMenuTrigger` rendering a `<Link href>` makes `Enter` both navigate and open the menu. The footer precedent (`app-sidebar.tsx:88`) avoids this by triggering on a non-link button. | **REVISION**: when collapsed, the parent renders as a **button (trigger only, not a link)**, and the parent's own destination becomes the **first item inside** the dropdown. Otherwise `Enter` is ambiguous and the parent's own page is either double-fired or unreachable |
| Group labels vanishing under `collapsible=icon` | `SidebarGroupLabel:403` uses `-mt-8 opacity-0`, **not** `display:none` — so the label text stays in the accessibility tree in both states. The ambiguity is purely visual. | **ADDITION**: `<SidebarGroup role="group" aria-labelledby={labelId}>` + `<SidebarGroupLabel id={labelId}>`. One unconditional wiring fixes the semantic grouping in both states; the `SidebarSeparator` between groups handles the visual ambiguity. Both, not either |
| Icon-only buttons without labels (P1 anti-pattern) | `sidebarMenuButtonVariants` clips the label via `overflow-hidden`, it does **not** `display:none` it, so each collapsed button keeps its accessible name. `tooltip` is supplementary, not the accessible name. | No change needed — but `SidebarMenuSub:644`/`SubButton:682` use `group-data-[collapsible=icon]:hidden`, i.e. `display:none`, which removes children from the a11y tree *and* from tab order. This reinforces that the regression is functional, not cosmetic |
| Minimum hit target 44×44 (P2) | Collapsed buttons are `size-8` = **32×32px** inside a `SIDEBAR_WIDTH_ICON = 3rem` (48px) rail — under the 44px guideline. But `data-collapsible="icon"` is set **only on the desktop branch** (`sidebar.tsx:212`, inside a `hidden md:block` wrapper); `isMobile` renders a `Sheet` at `SIDEBAR_WIDTH_MOBILE = 18rem` with no `data-collapsible` attribute at all. | **The collapsed rail is desktop-and-pointer-only and never a touch surface**, so the 44px rule does not bind. Flagged, not "fixed": raising it would mean editing `sidebar.tsx`'s shared variant, which this design deliberately does not touch. Corollary: the collapsed-submenu regression is also desktop-only — inside the mobile `Sheet` the submenu renders normally |
| Instant state changes / motion (P2, P7) | `SidebarGroupLabel` already carries `transition-[margin,opacity] duration-200 ease-linear`; the container transitions are also `duration-200`. | Already inside the 150-300ms band. No change; opacity/margin only, so no reduced-motion special case warranted |
| Hover-only reliance (P2 anti-pattern) | shadcn's `Tooltip` responds to focus as well as hover; the dropdown opens on click/`Enter`. | No change |
| Overloaded nav (P9) | Admin: 3 + 2 + 3 items (+1 nested) = 9. Técnico: 3 + 1 = 4, in two groups. | Within budget |

`web-design-guidelines` is a review skill that fetches Vercel's Web Interface Guidelines over the network; I have no `WebFetch` in this toolset, so the rules above were applied from knowledge of that ruleset rather than a fresh fetch. The interaction/a11y items it would flag here (accessible names, focus return, hit targets, motion duration) are covered in the table. `frontend-design` was read and judged **not applicable**: it directs bold, distinctive new aesthetic directions, whereas this change extends an existing shadcn shell on stock tokens — the phase rule "follow the existing pattern" governs, and inventing a new visual direction for a sidebar mid-change would be scope creep.

### Header

`AppSidebar` gains `workshop: { name: string | null; hasLogo: boolean; version: string | null }`, fetched in `layout.tsx`.

- A `WorkshopLogo` client component renders `<img src={`/api/workshop-config/logo?v=${version}`} width={32} height={32} …>` inside the **same fixed `size-8 rounded-lg` box** the current `GalleryVerticalEnd` occupies (`app-sidebar.tsx:48`). The box reserves its space unconditionally ⇒ **no layout shift** whether the image loads, 404s, or is still in flight.
- Fallback ladder: no `logoR2Key` **or** `onError` fires → `GalleryVerticalEnd`; `name === null` → `"Dforce"`.
- **Single line only.** Per the settled orchestrator decision the static `"Catálogos"` subtitle is REMOVED — the header is workshop logo + workshop name. Dropping the second line means the `grid` wrapper at `app-sidebar.tsx:51` collapses to one row; keep `size="lg"` on the button so the 48px header height (and therefore the logo box) is unchanged, otherwise removing a line shifts every row below it.
- **Rejected — `next/image`**: its optimizer refuses SVG unless `dangerouslyAllowSVG` is set globally, which is precisely the flag this design avoids; and it adds nothing over our own same-origin route that already sets `Cache-Control`/`ETag`.

---

## Decision 6 — User button, account settings, user management

| Surface | Choice | Rationale (from this codebase) | Rejected |
|---|---|---|---|
| Footer button | name on top, `ROLE_LABELS[role]` underneath; avatar initial from `name ?? username`; opens the existing `DropdownMenu` with a new "Mi cuenta" link beside `ThemeToggle`/`LogoutButton` | fixes `app-sidebar.tsx:96-100` printing the role twice; the dropdown is already the identity menu | replacing the dropdown with a dialog — loses `ThemeToggle`/logout placement |
| Account settings | **route** `/account` | it holds two distinct forms and one destructive side effect (session revocation) that needs real explanatory copy; this repo reserves Dialogs for single-entity create/edit (`CustomerForm`) and full pages for configuration (`/template-config`) | dropdown-inline (no room for password + confirmation copy); Dialog (destructive action in a 400px modal) |
| User management | **route** `/users` (admin-only, reached from the `Configuración` nav group per decision #9) + **Dialog** create/edit, i.e. `/customers` + `CustomerFormTrigger` + `CustomerForm` verbatim. Scope per decision #10 is **create + edit + deactivate** (name, email, role, active status) | structurally identical to `/customers`: list of entities with create/edit. Reusing the pattern is a smaller diff and a familiar review | a bespoke inline-editing table with no precedent here |

Where the display name comes from: `getUserProfile(userId)` in `src/modules/account/queries.ts`, called from `layout.tsx`. **Rejected — a new `x-user-name` proxy header**: it would be forwarded on every request including API calls that never need it, and `Headers.set` rejects non-latin-1 values in undici — "Martín" would throw. A DB lookup in one Server Component is both cheaper and correct.

### Password change + session revocation

```
POST /api/account/password  { currentPassword, newPassword }
  verifyPassword(currentPassword)         -> 400 on mismatch, NO hash write
  UPDATE users SET password_hash
  revokeOtherSessions(userId, keepTokenId = cookies().get(SESSION_COOKIE))
```

The current session **survives**. Rationale: the user is the actor and holds both plaintexts, so ending their own tab is pure UX punishment; requiring `currentPassword` is what actually blocks a stolen-cookie attacker from locking the owner out. The cookie value **is** `sessions.id` (`issueSession` inserts `id: token`), so no extra lookup is needed. New `revokeOtherSessions(userId, keepTokenId: string | null)` in `session.ts` sets `revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND ($2 IS NULL OR id <> $2)`; injecting it lets the route test assert `keepTokenId === currentToken`, which is the assertion the proposal's low-likelihood risk asks for. Email/name change does **not** revoke (sessions key on `userId`).

### Admin user creation

**Choice**: the admin types an initial password in the create dialog, validated identically to self-service, **and the account is flagged for a forced change on first login** (decision #11, designed in full as Decision 8 below). **Rejected — emailed invite link**: needs an auth-grade email path; Resend exists but is reminder-scoped, and it costs a tokens table, expiry handling, an email template and a whole extra PR. **Rejected — system-generated password shown once**: still depends on the same out-of-band handoff, plus a "copy this now or lose it" UX.

> **This reverses the earlier position in this document** that there would be no `must_change_password` column in v1 because it "would need a proxy-level interception". The interception is now in scope and specified in Decision 8. The residual risk that motivated deferral — the admin knowing a técnico's password indefinitely — is what decision #11 closes.

**Admin password reset for another user** is included: same `revokeOtherSessions(targetUserId, null)` call, all of that user's sessions die, and the target is re-flagged `must_change_password`. Without it a locked-out técnico has no recovery path at all.

**Duplicate `email`** on create/edit returns 409 with the existing `DuplicatePhoneError` shape. The self/last-admin guards now cover three mutations and are specified in Decision 7.

---

## Decision 7 — Soft deactivation, and how a deactivated user is actually blocked

**Schema**: `users.deactivatedAt: timestamp | null` (NULL = active).

**Rationale**: this is exactly `sessions.revokedAt`'s shape and semantics, so it reuses a pattern already in the schema; it records *when*, which an audit of "who lost access and when" needs; and NULL-means-active requires no backfill. **Rejected — `active boolean not null default true`**: same no-backfill property but throws away the timestamp, and `active = false` cannot distinguish "deactivated last week" from "never activated". **Rejected — hard delete**: forbidden by decision #10, and `ordenServicio.createdBy` references `users` with `onDelete: "set null"`, so deleting a técnico would silently erase authorship on their historical service orders — precisely the referential-integrity loss the decision names.

### Where the block lives

The matrix gates by **role**, not by account state, so a deactivated `administrador` still satisfies every `can()` call. The check must live somewhere `can()` is not.

| Candidate | Verdict |
|---|---|
| `can()` in `policy.ts` | **Rejected.** It is pure, synchronous and takes only `{ role }`; threading account state in would force it to accept a full user row and turn a compile-time-total matrix into a runtime state machine. This is the trap to avoid, not the answer |
| `requireSession()` | **Rejected.** It reads forwarded headers with no DB access (`session.ts:81`), so it would need a fresh query in every route handler |
| `src/proxy.ts` after `validateSession` | Workable, but duplicates for a fee what the option below gets for free, and puts account-state policy in the transport layer |
| **`validateSession()` in `session.ts`** | **Chosen** |

**Why `validateSession()`**: it already `innerJoin`s `users` and selects `users.role` (`session.ts:41-51`), so adding `deactivatedAt` to that projection costs **zero extra queries**, and it is the one chokepoint `src/proxy.ts` runs on every matched request. Returning `null` for a deactivated user reuses the existing "invalid/expired/revoked" path verbatim: pages redirect to `/login`, API routes get 401 JSON. Semantically clean — a deactivated account simply has no valid session.

Keep the predicate pure and separate so it is unit-testable with no DB, mirroring the existing `isSessionActive`:

```ts
export function isUserActive(user: { deactivatedAt: Date | null }): boolean { return user.deactivatedAt === null; }
// validateSession: if (!row || !isSessionActive(row) || !isUserActive(row)) return null;
```

### Immediate revocation, or fail on next request? Both — three touch points

1. **`authenticateUser()`** (`src/modules/auth/authenticate.ts`) refuses a deactivated user with the **same generic error** as a bad password — no account-state enumeration, consistent with the existing no-user-enumeration rule.
2. **`validateSession()`** refuses existing sessions on their very next request.
3. **`deactivateUser()`** sets `deactivatedAt` **and** calls the already-designed `revokeOtherSessions(targetId, null)`.

**Why all three rather than just revocation**: revoking existing sessions does nothing about a *new* login, so without (1) the user simply signs in again — that alone makes (1) mandatory. **Why all three rather than just (1) + (2)**: (3) costs one `UPDATE` and makes the state visible in the `sessions` table, so an admin inspecting the DB sees revoked rows instead of apparently-live ones, and the block survives even if someone later refactors the `isUserActive` call out of `validateSession`. **Rejected — revocation only**: bypassable via re-login. **Rejected — `validateSession` only**: correct but leaves stale rows that read as active.

Effective latency is one request, i.e. immediate for any practical purpose; the design does not claim to kill an in-flight request already past the proxy.

### Last-active-administrator guard

One pure function covering all three dangerous mutations:

```ts
export function checkAdminSafety(input: {
  actorId: string; targetId: string;
  operation: "change-role" | "deactivate";
  activeAdminIds: readonly string[];      // role = administrador AND deactivatedAt IS NULL
}): "self_role_change" | "self_deactivate" | "last_active_admin" | null;
```

Rules: an actor may not change **their own** role; may not deactivate **their own** account; and no operation may reduce the active-administrator count to zero.

Two subtleties worth stating: "active administrator" means `role = 'administrador'` **AND** `deactivatedAt IS NULL`, so an already-deactivated admin does not count toward the floor (deactivating the second-to-last *active* admin is fine; the last one is not), and demoting an already-deactivated admin is a no-op for the count. Second, the count read and the write must sit in **one `db.transaction()`** — otherwise two admins demoting each other concurrently can both pass the guard and leave zero. Unlikely in a 2-3 user workshop, but the fix is one wrapper.

---

## Decision 8 — Forced password change on first login

**Schema**: `users.mustChangePassword: boolean not null default false`. A boolean, not a timestamp: this is a flag that gets consumed and cleared, not an event worth auditing (contrast `deactivatedAt`). `default false` leaves every existing row untouched — no backfill.

**Path correction**: decision #11 names `src/modules/auth/proxy.ts`. **That file does not exist.** The real interceptor is `src/proxy.ts` (Next 16's renamed middleware), which imports from `@/modules/auth/session`. The interception goes in `src/proxy.ts`; the *predicate* lives in `src/modules/auth/forced-change.ts` so it is unit-testable without booting the proxy.

### The interception

`validateSession()` already returns the joined `users` row, so `SessionUser` gains `mustChangePassword: boolean` at **zero extra query cost** — the same free-ride as `deactivatedAt`.

```
src/proxy.ts, immediately after the existing `if (!user) redirect /login`:

if (user.mustChangePassword && !isPasswordChangeExempt(pathname)) {
  return isApiRoute
    ? NextResponse.json({ error: "password_change_required" }, { status: 403 })
    : NextResponse.redirect(new URL(CHANGE_PASSWORD_PATH, request.url));
}
```

The API-vs-page split reuses the branch `proxy.ts` already documents at lines 22-26: a browser tab cannot usefully follow a redirect returned to `fetch`, and a raw JSON body is not a usable response for a navigation. This is the same bug that file already fixed once for the 401 case; the forced-change case gets the identical treatment rather than a new one.

**Rejected — the check in `src/app/(app)/layout.tsx`**: it covers only pages inside that route group, misses every `/api/**` route, and a flagged técnico could keep driving the app through direct API calls. The proxy already holds the validated user for free.

### Avoiding the infinite redirect loop

The exemption allow-list is a pure function over one shared constant:

```ts
export const CHANGE_PASSWORD_PATH = "/change-password";
export function isPasswordChangeExempt(pathname: string): boolean;   // change-password page, POST /api/account/password, /api/logout
```

Three entries, each load-bearing:

| Exempt | Without it |
|---|---|
| `CHANGE_PASSWORD_PATH` | the redirect target itself redirects — infinite loop |
| `/api/account/password` | the screen renders but can never submit; the user is permanently stuck |
| `/api/logout` | a user unwilling to change their password is **trapped with no way out**, which is worse than the problem being solved |

Static assets and `_next/*` are already excluded by the existing `config.matcher`, so they need no entry.

The loop protection is **structural, not incidental**: `CHANGE_PASSWORD_PATH` is declared once and imported by both the proxy predicate and the page's own route, so renaming the route cannot desync it from its exemption. A unit test asserts `isPasswordChangeExempt(CHANGE_PASSWORD_PATH) === true` plus the other two entries — cheap, and it fails loudly if someone prunes the list.

### Reachability when `can()` denies everything

`/change-password`, `/api/account/password` and `/api/logout` are registered in `ROUTE_GUARDS` as **`"session-only"`** — never gated by an `Action`. If the forced-change screen required, say, an `account.self` action, a single matrix mistake would lock a user out of the only screen that can unlock them: an unrecoverable state. `route-guards.test.ts` asserts this exact set stays `"session-only"`, so nobody later "tightens" it into a lockout. Same reasoning already governs `/login`.

### A user mid-flow on another route

Page navigation redirects cleanly. An in-flight `fetch` gets 403 `password_change_required`, and **unsaved client form state is lost** — stated as an accepted cost, not designed around. In practice the flag is set at account creation, so it is almost always encountered at first login with nothing in flight; the exception is an admin password reset on a live user. A global fetch interceptor that surfaces a Spanish "debés cambiar tu contraseña" toast is the natural upgrade and is explicitly **out of scope** here.

### Interaction with session revocation — no special case

The forced change reuses `POST /api/account/password` **unmodified**, including its `currentPassword` verification: on the forced path the user does know the current password, because that is the one the admin gave them to log in with. So the already-designed rule applies as-is — `revokeOtherSessions(userId, keepTokenId = currentToken)` keeps the session the change is being completed in and kills the rest.

**Decided explicitly so nobody adds a branch**: a forced first change must NOT revoke the current session. Revoking it would log the user out the instant they succeed, bouncing them to `/login` to re-authenticate with the password they just set — it works, but it reads as a failure. On this path the set of other sessions is typically empty anyway, so the call is a harmless no-op and needs no conditional.

**Rejected — a separate `/api/account/initial-password` that skips `currentPassword`**: an authenticated-but-unverified password overwrite is a stolen-cookie account-takeover primitive, and it would apply to exactly the accounts most likely to have a shared or freshly-handed-over credential.

### When the flag is set and cleared

| Event | `mustChangePassword` |
|---|---|
| Admin creates a user | `true` |
| Admin resets another user's password | `true` |
| Successful self-service change via `POST /api/account/password` | `false`, in the **same transaction** as the hash write |
| Admin edits name / email / role / active status | unchanged |
| Voluntary password change by an unflagged user | stays `false` |

Clearing in the same transaction as the hash update is what prevents the half-state "password changed but still flagged", which would trap the user in the change screen forever.

---

## Data Flow

```
src/proxy.ts
  validateSession(token) ── innerJoin users ── isSessionActive · isUserActive · mustChangePassword
     ├ null                          → /login (page) | 401 (api)
     ├ mustChangePassword && !exempt → /change-password (page) | 403 password_change_required (api)
     └ ok                            → forward x-user-id / x-user-role
                                        │
                                        ▼
proxy.ts ──x-user-id/x-user-role──▶ layout.tsx ──▶ requireSessionFromHeaders()
                                        │            getUserProfile(id)      ─┐
                                        │            getWorkshopConfig()  ────┤ React cache()
                                        ▼                                     │
                                  getNavGroups(user) ── can() ── MATRIX ◀──────┘
                                        ▼
                            AppSidebar { groups, user, workshop }
                              ├ SidebarHeader  → WorkshopLogo → GET /api/workshop-config/logo → r2.getObject
                              ├ SidebarContent → groups; settings group mt-auto
                              │                  collapsed ? DropdownMenu : SidebarMenuSub
                              └ SidebarFooter  → name + ROLE_LABELS → "Mi cuenta" → /account

LogoUploadField ─multipart─▶ POST /api/workshop-config/logo
                              withAuthorization("workshop.edit")
                              → logo.ts (sniff · cap · sanitize/reject)
                              → putObject(key, buf, contentType)
                              → UPDATE workshop_config → deleteObject(oldKey) best-effort
```

---

## File Changes

| File | Action | What |
|---|---|---|
| `src/modules/auth/roles.ts` | Create | `Role`, `ROLES`, `ROLE_LABELS`, `isRole()` |
| `src/modules/auth/policy.ts` | Modify | `ACTIONS`, total `MATRIX`, default-deny `can()` |
| `src/modules/auth/guard.ts` | Create | `withAuthorization(action, handler)` |
| `src/modules/auth/route-guards.test.ts` | Create | `ROUTE_GUARDS` registry + fs-enumeration completeness test |
| `src/modules/auth/session.ts` | Modify | `Role` re-export, `isRole()` in `parseSessionUser`, `revokeOtherSessions()`, `isUserActive()`, `deactivatedAt`+`mustChangePassword` in the `validateSession` projection, `SessionUser.mustChangePassword` |
| `src/modules/auth/authenticate.ts` | Modify | refuse deactivated users with the existing generic error |
| `src/modules/auth/forced-change.ts` | Create | `CHANGE_PASSWORD_PATH`, `isPasswordChangeExempt()` |
| `src/proxy.ts` | Modify | forced-password-change interception (page redirect vs API 403) |
| `src/app/(app)/change-password/page.tsx` | Create | forced-change screen, `"session-only"` |
| `src/shared/db/schema.ts` | Modify | enum values, `users.name`/`email`/`deactivatedAt`/`mustChangePassword`, `workshop_config` |
| `src/shared/db/migrations/0007_*.sql` | Create | generated + hand-edited enum rename & backfill |
| `src/modules/workshop-config/{service,logo}.ts` | Create | singleton service + pure logo validation/sanitization |
| `src/modules/workshop-config/{WorkshopConfigForm,LogoUploadField}.tsx` | Create | sectioned form + upload widget |
| `src/app/api/workshop-config/route.ts` | Create | JSON GET/POST, `workshop.read`/`workshop.edit` |
| `src/app/api/workshop-config/logo/route.ts` | Create | multipart POST, DELETE, sandboxed GET |
| `src/app/(app)/workshop-config/page.tsx` | Create | "Config. del CRM" |
| `src/modules/catalog-storage/r2.ts` | Modify | `putObject(..., contentType = "application/pdf")` |
| `src/modules/layout/nav-items.ts` | Modify | `NavGroup`/`NavParent` model + per-action filtering |
| `src/components/app-sidebar.tsx` | Modify | groups, separators, submenu/dropdown, header, footer |
| `src/components/ui/sidebar.tsx` | **Unchanged** | primitives already exported |
| `src/app/(app)/layout.tsx` | Modify | fetch profile + workshop config, pass groups |
| `src/modules/account/{queries,service}.ts` | Create | profile read, profile/password update, admin user create/edit/deactivate, `checkAdminSafety()` |
| `src/modules/account/{ProfileForm,PasswordForm,UserForm,UserFormTrigger}.tsx` | Create | Dialog/route forms per Decision 6 |
| `src/app/(app)/account/page.tsx`, `src/app/(app)/users/page.tsx` | Create | account + admin user management |
| `src/app/api/account/{route,password/route}.ts`, `src/app/api/users/{route,[id]/route}.ts` | Create | gated mutations |
| `src/modules/inventory-view/InventoryStatsHeader.tsx` | Modify | delete local `ROLE_LABELS`, import shared |
| every route in `src/app/api/**` + `(app)/**/page.tsx` | Modify | `withAuthorization` / `can()` per `ROUTE_GUARDS` |
| `scripts/seed-user.mjs`, `README.md`, `src/e2e/full-flow.e2e.test.ts` | Modify | `usuario` → `tecnico` string literals |

---

## Testing Strategy (Strict TDD, `vitest run`)

`vitest.config.ts` pins a fake `DATABASE_URL` and excludes `src/e2e/**`, so anything below "Unit" must be DB-free. Tests are written first; the policy cross-product must go **red** on today's `policy.ts` (`catalogs.generate` does not exist yet).

| Layer | What | How |
|---|---|---|
| Unit | `MATRIX` correctness | `policy.test.ts` holds an **independent hand-written** Action × Role literal table with explicit booleans. Deriving expectations from `MATRIX` would be tautological and would not catch a typo. |
| Unit | default-deny, unknown role | `can({role:"ghost"}, …) === false`, never throws; `isRole()` truth table |
| Unit | forgotten gates | `route-guards.test.ts`: fs enumeration completeness + 403 assertions for denied `tecnico` actions (short-circuits before DB) |
| Unit | nav | `nav-items.test.ts`: exact group/label trees per role; empty-group pruning; parent-denied drops children; admin sees `Usuarios`, técnico does not |
| Unit | logo validation | `logo.test.ts`: magic-byte sniff per format, 2 MB / 512 KB caps, SVG reject cases (`<script>`, `<foreignObject>`, `on*=`, remote `xlink:href`, `<!DOCTYPE`), sanitized-output stability |
| Unit | workshop config | `validateWorkshopConfigInput` pure, mirroring `template-config/service.test.ts` |
| Unit | schema | `roleEnum.enumValues === ["tecnico","administrador"]`; `users.name` nullable; `users.email` nullable + unique; `users.deactivated_at` nullable; `users.must_change_password` notNull + default `false`; `workshop_config` column set/nullability via `getTableConfig` |
| Unit | account | password route: wrong `currentPassword` → 400 **and no hash write**; success calls `revokeOtherSessions(userId, cookieToken)` and clears `mustChangePassword` in the same write; admin reset calls it with `null` and sets the flag |
| Unit | admin guards | `checkAdminSafety()` truth table: self role change, self deactivate, last active admin, deactivated admins excluded from the floor, demoting an already-deactivated admin is a no-op; duplicate email → 409 |
| Unit | deactivation | `isUserActive()` predicate; `validateSession` returns `null` for an active session belonging to a deactivated user (DB-free — inject the row); `authenticateUser` refuses a deactivated user with the **same generic error** as a bad password (no state enumeration) |
| Unit | forced change | `isPasswordChangeExempt()` returns true for `CHANGE_PASSWORD_PATH`, `/api/account/password`, `/api/logout` and false for a normal route — this is the anti-infinite-loop test; `route-guards.test.ts` asserts those three plus `/login` stay `"session-only"` so no `Action` can ever be attached |
| Unit | proxy interception | `proxy()` with a flagged user: page path → 307 to `CHANGE_PASSWORD_PATH`, `/api/**` path → 403 `password_change_required`, exempt path → passes through with `x-user-*` headers set. `validateSession` is injected/mocked, so no DB |
| Unit | routes | existing `handleX(request, deps)` + `NextRequest` forged-header pattern, extended with `x-user-role: tecnico` cases |
| Integration (real Postgres, **not** `npm test`) | migration 0007 on a DB holding `usuario` rows; `drizzle-kit generate` emits no new migration afterwards; `putObject` content-type round-trip against R2 | documented commands, run manually |
| Manual / E2E (**never run here**) | collapsed-rail reachability of "Configuración de template" **via keyboard only** (Tab to the trigger, `Enter`, arrow keys, `Escape`, focus returns to trigger); logo appears after upload with no layout shift; direct navigation to `/api/workshop-config/logo` with a scripted SVG executes nothing; password change keeps the current tab and kills a second browser; a just-deactivated user's open second browser is bounced to `/login` on their next click; a freshly created user cannot reach any route except the change-password screen and logout, and is released the moment they change it | checklist in the PR body |

---

## Migration & Rollout Order

Schema → policy → settings → UI → account → users. Same feature-branch-chain as `crm-workshop-management`, tracker stays draft so `main` never sees a half-applied matrix.

| Step | Contents | Depends on | Note |
|---|---|---|---|
| 1 | `roles.ts`, schema (incl. `deactivated_at`, `must_change_password`), migration 0007, `schema.test.ts`, string-literal callers | tracker | `Role` rename makes `tsc` enumerate every stale caller. All four new columns ship in **one** migration — a second migration later for user management would be pure churn |
| 2 | `ACTIONS` + `MATRIX` + default-deny `can()`, `guard.ts`, `ROUTE_GUARDS` + tests, gates on **every** route/page | 1 | must land **atomically** — matrix without gates leaves routes open; gates without matrix 403s everything |
| 3 | `workshop-config` service + `logo.ts` + `r2.ts` param + upload/serve routes | 1 | pre-declared 3a/3b split if over budget: 3a service+logo+routes, 3b page+form |
| 4 | grouped `nav-items` (incl. `Gestión de usuarios`, `pinBottom`), `AppSidebar` groups/separators/`aria-labelledby`/collapsed dropdown/single-line header/footer, `layout.tsx` fetches | 2, 3 | `sidebar.tsx` untouched. The nav entry ships here even though `/users` lands in step 6 — see note below |
| 5 | `/account`, profile + password + revocation + `mustChangePassword` clearing | 1, 4 | |
| 6 | `isUserActive` in `validateSession`, `authenticateUser` refusal, `forced-change.ts` + `src/proxy.ts` interception, `/change-password` screen | 1, 5 | **enforcement half** of decisions #10/#11. Reuses step 5's password endpoint unmodified |
| 7 | `/users` admin management: list, create, edit, deactivate, `checkAdminSafety()` | 2, 5, 6 | **UI half**. Must land after 6, never before — see below |

Steps 2 and 3 are mutually independent and reviewable in parallel.

**Two ordering constraints that are not obvious:**

- **Step 6 before step 7.** Shipping the deactivate button before `validateSession`/`authenticateUser` enforce it produces a UI that *claims* to revoke access while the user keeps working — worse than no feature, because an admin would believe a departed employee was locked out. If the two must land together for review-size reasons, they merge as one unit; step 7 must never precede step 6.
- **Step 4's nav entry precedes step 7's route.** `Gestión de usuarios` appears in the sidebar one step before `/users` exists. Either gate the nav item behind step 7 or accept a 404 for admins on the tracker branch only — acceptable because the tracker stays draft and `main` never sees the intermediate state, but it must be a deliberate choice rather than a surprise in review.

Rollback runs in reverse; step 1 rolls back via a new `0008` migration, never by deleting 0007. Rolling back step 6 while leaving step 7 in place re-opens access for deactivated users — revert them together.

---

## Open Questions

- [ ] Can the R2 bucket stay fully private now that the logo is served exclusively through our own route? A verification task for step 3, not a user decision.
- [ ] Should a deactivated user still appear in the `/users` list (greyed, with a "Reactivar" action), or be filtered out by default behind a "mostrar inactivos" toggle? Reactivation is implied by soft deactivation but decision #10 does not name it. Assumed in scope as the inverse of deactivate; confirm with `sdd-spec`.
- [ ] Password policy for the admin-entered initial password: reuse whatever `POST /api/account/password` enforces, or require something stronger given it travels out-of-band? Currently assumed identical.

*Resolved since the first draft*: the sidebar header's second line is removed (settled orchestrator decision — logo + workshop name only), and a técnico's pre-existing catalogs remain listable under `catalogs.read` with ownership logic untouched.
