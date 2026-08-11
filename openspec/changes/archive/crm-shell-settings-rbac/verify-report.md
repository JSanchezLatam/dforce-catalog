# Verification Report: crm-shell-settings-rbac (v1)

**Verified commit range**: `b93399d..c5a2a6c` on `main` (11 commits, 76 files, +5235/-196).
**Implemented by**: OpenCode, outside this session — no PR, no prior human/adversarial review.
**Scope verified**: Work units 1, 2a, 2b, 3a, 3b, 3c, 4a, 4b, 5a, 5b only (per Round 5 decision + tasks.md "Scope boundary"). Work units 6, 7a, 7b, 7c (deactivation enforcement, forced-password-change, admin user-management CRUD) are DEFERRED and were NOT evaluated as v1 acceptance criteria.

## Verdict: FAIL (3 CRITICAL, 7 WARNING, 2 SUGGESTION)

## Build / Test Evidence

| Command | Result |
|---|---|
| `npm test` (vitest run) | **401/401 tests passing, 46/46 files** |
| `npx tsc --noEmit` | **Clean, 0 errors** |
| `npm run lint` | 5 errors, 19 warnings — **all 5 errors are in files this change never touched** (`src/hooks/use-mobile.ts`, `src/modules/catalog-builder/CatalogBuilderForm.tsx`, `src/modules/catalog-builder/TreeSelect.tsx`, `src/modules/layout/ThemeToggle.tsx` — confirmed via `git diff --stat` against these paths returning empty). Pre-existing debt, not introduced here. The warnings on new files (`WorkshopLogo.tsx`, `app-sidebar.tsx`, `policy.test.ts`, `nav-items.test.ts`, `workshop-config/service.ts`, `LogoUploadField.tsx`) are all cosmetic (`no-img-element`, unused vars). |

401 passing tests is real evidence for what the tests actually assert — but several of the CRITICAL/WARNING findings below exist precisely because the tests assert the wrong thing (mocked away the broken code path, or codified the wrong behavior as the expectation). Green tests here do NOT mean the feature works end-to-end.

---

## CRITICAL Findings

### C1 — Workshop logo upload can never actually persist (WU3a/3b)

`saveWorkshopConfig()` silently drops `logoR2Key`/`logoContentType` on every call, no matter what the caller passes.

- `src/modules/workshop-config/service.ts:20-34` — `validateWorkshopConfigInput()` only ever returns `{ name }`. It has no `logoR2Key`/`logoContentType` fields in its return type at all.
- `src/modules/workshop-config/service.ts:43-55` — `saveWorkshopConfig()` destructures `const { name } = validateWorkshopConfigInput(input)` and then does `db.insert(workshopConfig).values({ id, name, updatedAt }).onConflictDoUpdate({ target: workshopConfig.id, set: { name, updatedAt } })`. The `set` clause **only ever touches `name` and `updatedAt`** — `logoR2Key`/`logoContentType` are never part of the INSERT or the UPDATE.
- `src/app/api/workshop-config/logo/route.ts:72` — the POST handler calls `saveWorkshopConfig({ id: "singleton", name: prev?.name ?? null, logoR2Key: key, logoContentType: logo.contentType, updatedAt: new Date() })`, believing this persists the new key. It does not — those two fields are discarded by the layer above.
- Consequence: a real admin can upload a logo all day; the DB row's `logoR2Key` stays `NULL` forever (first insert) or unchanged (subsequent conflict-updates never touch it). `GET /api/workshop-config/logo` checks `if (!config?.logoR2Key) return 404` — so the logo will **404 forever**, and the sidebar's `WorkshopLogo` component will silently fall back to the default icon on every load. This breaks workshop-settings spec's "Singleton Workshop Config" and every "Logo Upload" scenario end-to-end, despite all 3a/3b/3c tasks being marked `[x]`.

**Why the test suite didn't catch it** (Strict TDD compliance failure, instruction #13):
- `src/app/api/workshop-config/logo/route.test.ts:14-17` mocks `saveWorkshopConfig` entirely via `vi.mock(...)`, so the real function is never invoked by the route test — it only proves the route *calls* `saveWorkshopConfig`, never that persistence actually happens.
- `src/modules/workshop-config/service.test.ts:38-46` is the one test that exercises the real `saveWorkshopConfig()`, but it only ever calls it with `{ name: "Taller" }` — it never passes `logoR2Key`, so the bug has zero coverage anywhere in the suite.

This is the single most severe finding: a fully-tested-looking, fully-checked-off feature (WU3a/3b/3c, ~3 work units) is dead in production.

### C2 — Email format + duplicate validation is completely unimplemented (WU5a)

Spec `user-account` "Requirement: Email Validation" demands: standard-format validation, cross-user uniqueness, and "unchanged own email not flagged as duplicate." None of this exists.

- `src/modules/account/service.ts:8-20` — `updateProfile()` writes `data.email` straight to the DB with zero validation of any kind.
- `src/app/api/account/route.ts:16-23` — the PATCH handler passes `body.email` through unchanged; no format check, no duplicate check, no distinct error path.
- `src/modules/account/service.test.ts:5-17` — only 2 tests for `updateProfile`, neither touches email format or duplicates.
- Consequence: `email = "not-an-email"` is silently persisted. A genuine duplicate email will trigger the DB's raw `users_email_unique` constraint violation as an **uncaught exception surfacing as a 500**, not the specified 409-style rejection with a friendly message — the opposite of what the spec's "Duplicate email" scenario requires.
- `tasks.md` marks 5a.3 ("RED service.test.ts ... email format validation; duplicate-email → 409-style error ... unchanged own email not flagged") and 5a.5 ("GREEN ... satisfying 5a.3-5a.4") as `[x]`, but neither the RED test nor the GREEN implementation for this specific requirement exists in the diff. The task checklist does not reflect the actual code state.

### C3 — Nav item "Inventario" violates a BINDING Round-1 decision (misgrouped under Catálogo, not CRM)

Binding decision #2 (Round 1, `sdd/crm-shell-settings-rbac/decisions`, id 416): *"Inventario lives inside the CRM sidebar group (with Clientes and Órdenes de servicio)."* The app-navigation spec's grouping table repeats this explicitly: CRM = {Clientes, Órdenes de servicio, Inventario}; Catálogo = {Generar Catálogos, Catálogos Generados}.

- `src/modules/layout/nav-items.ts:16-19` — `CRM_ITEMS` contains only Clientes + Órdenes de servicio (2 items, spec says 3).
- `src/modules/layout/nav-items.ts:21-25` — `CATALOGO_ITEMS` contains Inventario, Generar Catálogo, Catálogos (3 items, spec says 2) — **Inventario was placed in the wrong group.**
- `src/modules/layout/nav-items.test.ts:42-46,62-66` — the test suite explicitly asserts `cat.items` (Catálogo group) `.toEqual(["Inventario", "Generar Catálogo", "Catálogos"])` for admin, and `["Inventario", "Catálogos"]` for técnico — i.e. **the test was written to match the wrong implementation, not the spec.** Total item counts per role happen to still equal 7 (admin) and 4 (técnico), matching the spec's aggregate numbers by coincidence, which is exactly why this slipped through 401 green tests undetected.
- Impact: this is a real UX/IA regression against an explicit user decision, not a cosmetic label issue — a técnico or admin looking under "CRM" for inventory will not find it there.

---

## WARNING Findings

### W1 — `ROLE_LABELS.tecnico` does not match the spec's exact display string
`src/modules/auth/roles.ts:6` — `tecnico: "Técnico"`. Both `role-permissions/spec.md:11` and `app-navigation/spec.md:45,115-127` specify the exact label `"Técnico de taller"`. No test asserts the label's text anywhere (`roles.test.ts` only tests `isRole()`), so this silently diverges across the sidebar footer, `InventoryStatsHeader`'s greeting, and anywhere else `ROLE_LABELS` is read.

### W2 — Nav item labels drift from the spec's "exact label" table
`src/modules/layout/nav-items.ts:23` — `"Generar Catálogo"` vs spec's `"Generar Catálogos"` (plural). `nav-items.ts:24` — `"Catálogos"` vs spec's `"Catálogos Generados"`. The spec table is explicitly headed "Item (exact label)."

### W3 — No lockout-safety regression test pins `/api/login`/`/api/logout` as permanently `"session-only"`
`src/modules/auth/route-guards.test.ts` has exactly two tests: registry-completeness (fs enumeration) and action-reachability. Neither asserts that `ROUTE_GUARDS["/api/login"]`/`["/api/logout"]` stay `"session-only"` and can never be reassigned an `Action`. Design (Decision 8, carried in decisions-r4) explicitly calls for this as an unconditional test ("if the unlock screen ever required an Action, one matrix mistake becomes an unrecoverable lockout"). Currently the values ARE correctly `"session-only"` (verified by reading the registry), but nothing prevents silent regression — this is a stated design requirement that never landed in the test file.

### W4 — Two pre-existing route tests still forge a role that no longer exists, silently losing their intended coverage
`src/app/api/template-config/route.test.ts:6,20,26` and `src/app/api/inventory-sync/manual/route.test.ts:7,16,21` still use `x-user-role: "usuario"` — a value the enum rename eliminated (`role` is now only `tecnico`/`administrador`). Under default-deny, an unrecognized role string still yields `403`, so these tests still pass, but they are no longer testing "técnico is denied `template.edit`/`sync.manual`" — they are testing "an unknown role is denied," which is a materially different (and trivial) assertion. If `MATRIX.tecnico["template.edit"]` were flipped to `true` by mistake, these two files would not catch it. Task 1.5 ("Update any file outside this change that references 'usuario' — grep the entire codebase") was not fully executed.

### W5 — Accessibility fix from Round 4 decision ("unconditional... both, not either") is missing
`src/components/app-sidebar.tsx:125-126` — `<SidebarGroup className={...}><SidebarGroupLabel>{group.label}</SidebarGroupLabel>` has neither `role="group"` nor `aria-labelledby`/`id` wiring. Decisions-r4 explicitly states: *"Apply `<SidebarGroup role="group" aria-labelledby>` + `<SidebarGroupLabel id>` AND a visual separator — both, not either."* The separator (`SidebarSeparator` between groups) IS present; the ARIA wiring is not.

### W6 — `nav-items.test.ts` never explicitly tests "nothing pins when Configuración is absent"
Task 4a.1 calls for an explicit assertion: *"build a técnico tree and assert nothing renders pinned."* The actual test file only asserts técnico sees 2 groups (`CRM`, `Catálogo`, no `Configuración`) and separately asserts `pinBottom: true` for admin's `Configuración` group. There is no técnico-side assertion like `groups.every(g => !g.pinBottom)`. Functionally correct today (Configuración, the only `pinBottom` group, is simply absent for técnico), but the explicit regression net the task called for was not written.

### W7 — Logo object key uses `Date.now()` instead of design's `crypto.randomUUID()`
`src/app/api/workshop-config/logo/route.ts:64` — `const key = \`logos/${Date.now()}.${logo.ext}\`;`. Design Decision 4 specifies `workshop/logo-${crypto.randomUUID()}.${ext}` specifically for unguessability and to eliminate collision risk. A millisecond timestamp is both more predictable and theoretically collidable under concurrent uploads (low likelihood in a 2-3 person workshop, but an unstated deviation from an explicit design choice).

---

## SUGGESTION Findings

### S1 — No regression test for `r2.ts`'s `putObject` default content-type
No `r2.test.ts` exists (before or after this change). `src/modules/catalog-storage/upload-status.test.ts` fully mocks `putObject`, so it never exercises the real function's new third parameter default (`contentType = "application/pdf"`). Low risk — the change is an additive default parameter and `tsc --noEmit` is clean — but per instruction #11 there is no direct test proving existing PDF callers are unaffected.

### S2 — Unused import in `workshop-config/service.ts`
`src/modules/workshop-config/service.ts:2` imports `PgTableWithColumns` and never uses it (lint warning). Cosmetic.

---

## Things Verified Correct (stated for trust, not padding)

- **Permission matrix shape is exactly right**: `type Grants = { readonly [A in Action]: boolean }` and `MATRIX: { readonly [R in "tecnico"|"administrador"]: Grants }` (`src/modules/auth/policy.ts:21-58`) — a TOTAL doubly-mapped record, not `Record<Role, ReadonlySet<Action>>`. Adding an `Action` without both role entries is a `tsc` error. `policy.test.ts` holds an independent hand-written cross-product, not derived from `MATRIX` — not tautological.
- **Default-deny confirmed**: `can()` returns `false` for an unrecognized role and for an action not present in `MATRIX[role]` (`policy.ts:60-64`); tested explicitly (`policy.test.ts:58-63`).
- **`ROUTE_GUARDS` completeness test is real, not vacuous**: independently verified via `fd` that the filesystem actually contains 11 pages + 16 API routes = 27 files, which matches the registry's 27 keys exactly. This is genuine fs-enumeration, confirmed by hand, not a rubber-stamp test.
- **Migration is a correct `RENAME VALUE`, not `ADD VALUE`**: `0007_famous_tusk.sql:5` — `ALTER TYPE "public"."role" RENAME VALUE 'usuario' TO 'tecnico'`. `meta/0007_snapshot.json`'s `prevId` matches `0006_snapshot.json`'s `id`, and the journal tag `0007_famous_tusk` matches the file name — internally consistent.
- **`InventoryStatsHeader.tsx` was correctly updated** to import shared `ROLE_LABELS` instead of its own local `Record<SessionUser["role"], string>` map (`src/modules/inventory-view/InventoryStatsHeader.tsx:2,25`).
- **Técnico's catalogs remain listable**: `ROUTE_GUARDS["/catalogs"] = { GET: "catalogs.read" }`, and `catalogs.read`/`catalogs.download` are `true` for técnico while `catalogs.generate` is `false` — matches catalog-generation delta spec.
- **Collapsed sidebar dropdown trigger is button-only**: `NavParentCollapsed` (`app-sidebar.tsx:91-121`) wraps a plain `SidebarMenuButton` (no `render` prop, defaults to `<button>`, confirmed against `ui/sidebar.tsx:499-521`) inside `DropdownMenuTrigger` — not simultaneously a `Link`. Matches the design's explicit revision.
- **Logo validation/sanitization is solid**: magic-byte sniffing for PNG/JPEG/WebP/SVG, 2MB/512KB caps, SVG deny-list (`<script>`, `<foreignObject>`, `on*=`, remote `href`/`xlink:href`, `<!DOCTYPE`, `<!ENTITY`, `<a>` tags) all present and tested with real byte buffers, not mocked (`logo.ts`, `logo.test.ts`).
- **`workshop_config` correctly stores only `logoR2Key`, never a public URL** — no `logoUrl` column exists in schema.ts, matching the structural SVG-vector mitigation decision (moot in practice given C1, but the schema design itself is correct).
- **Password change flow is correctly tested end-to-end with real crypto**: wrong current password → `updateHash` never called (asserted via mock, not just response shape) + `changePassword` throws; correct password → `revokeOtherSessions(userId, keepTokenId)` called with the right token; uses real `hashPassword`/`verifyPassword`, not stubbed. Email-only change never touches `revokeOtherSessions`. This is genuine behavioral coverage, not shape-only.
- **v1 scope boundary was honestly respected**: `deactivatedAt`/`mustChangePassword` are present in `schema.ts` as genuinely inert columns — grepped the entire `src/` tree and confirmed zero code paths outside `schema.ts`/`schema.test.ts` read or write them. `src/proxy.ts` was not touched (confirmed via diff), consistent with the forced-password-change interception being correctly deferred, not half-built.
- **`r2.ts` generalization is backward compatible**: `putObject(key, body, contentType = "application/pdf")` — a defaulted parameter, zero required changes to existing 2-arg callers, `tsc` clean.

---

## Result Contract

- **status**: done
- **executive_summary**: 3 CRITICAL, 7 WARNING, 2 SUGGESTION — the logo-upload feature (WU3a/3b/3c) cannot persist despite passing tests, email validation (WU5a) is entirely unimplemented despite tasks.md marking it done, and the sidebar's "Inventario" item violates a binding Round-1 decision by living in the wrong nav group; 401/401 tests pass and `tsc` is clean, but green tests here mask real gaps rather than proving correctness.
- **artifacts**: Engram `sdd/crm-shell-settings-rbac/verify-report` | `openspec/changes/crm-shell-settings-rbac/verify-report.md`
- **next_recommended**: sdd-apply (fix C1, C2, C3 before archive; W1-W7 should be scheduled but do not block correctness of the core matrix/gating work)
- **risks**: C1 (workshop logo feature is dead in production), C2 (email validation absent — malformed emails persist, duplicate emails 500 instead of 409), C3 (Inventario nav placement violates binding decision #2)
- **skill_resolution**: none — no `## Skills to load before work` block or skill registry reference was provided in the launch prompt; proceeded on the phase skill (`sdd-verify/SKILL.md`) and shared conventions (`_shared/sdd-phase-common.md`) alone.
