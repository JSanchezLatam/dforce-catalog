# Tasks: user-lifecycle-management

Deferred scope from `crm-shell-settings-rbac` (Round 5 cut). Binding decisions:
`sdd/crm-shell-settings-rbac/decisions` (#416), `decisions-r4` (#420), `decisions-r5` (#422).
Specs (unchanged, already correct): `openspec/changes/crm-shell-settings-rbac/specs/user-management/spec.md`,
`.../specs/user-account/spec.md`. Design reference: `.../design.md` Decisions 6-8.

## Stale assumptions corrected during re-verification

- `users.deactivatedAt`/`mustChangePassword` **already exist** in `schema.ts` (inert). No migration task.
- `validateSession()` selects `role` but **not yet** `deactivatedAt`/`mustChangePassword`, and has **no injectable query seam** — real work, not "zero-cost" as design assumed.
- `src/proxy.ts`'s `!user` branch **always redirects**, even for API routes (only the `!token` branch checks `isApiRoute`). This pre-existing bug must be fixed for the deactivation spec's "401 JSON for API" requirement to hold — not scope creep, a blocking dependency.
- **Zero test coverage exists today** for `proxy.ts` and `authenticate.ts` — both get their first-ever test file here, inflating the estimate beyond the original plan.
- Component testing (Vitest jsdom + RTL) **did not exist** when WU7b was originally sized as "no UI coverage possible." It now does (PR #14) — every interactive surface below gets a real `*.test.tsx`, which is the single biggest reason totals exceed the old ~1,175-line estimate.
- `nav-items.ts`'s `Configuración` group already has the 2-child shape from PR #13; adding "Gestión de usuarios" is a 1-line array entry, not a data-model change.
- Spec `user-account` has a "New Password Must Differ From the Temporary One" requirement **not covered by any current design decision** — added as an explicit task (WU3).
- **Corrected during WU3 apply**: task 3.7/3.8's prescribed `changePassword(..., { requireDifferentFromCurrent: true })` **has no caller that could supply it**. `parseSessionUser()` deliberately does not forward `mustChangePassword` to route handlers (`session.ts`), so `POST /api/account/password` cannot know the flag. Shipped instead as a flag **derived inside `changePassword()`**, riding along on the `SELECT` that already fetches the password hash (zero extra queries, same free ride Decision 8 takes in `validateSession()`). Strictly safer: the rule cannot be bypassed by a caller omitting an optional argument.
- **Also corrected during WU3 apply**: `/login` and `/` had **no `ROUTE_GUARDS` entry at all** — the completeness test only enumerated pages under `(app)`, so any page outside that group was invisible to the registry. Enumeration now covers every `page.tsx` under `src/app`, and the registry gained a `"public"` value for the genuinely session-less `/login` (distinct from `"session-only"`, which still requires a valid session).
- **Also corrected during WU3 apply**: `POST /api/account/password` was `can(user, "account.self")`-gated, contradicting Decision 8's requirement that the unlock path never be Action-gated. Gate removed; route is now `"session-only"` and pinned by the new lockout-safety test (closes verify-report W3).

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,975 (7 chained slices, pre-split where >400) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Tracker → WU1 → WU2 → WU3 → WU4a → WU4b → WU5a → WU5b |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units (feature-branch-chain: PR1 base=tracker, PRn base=PRn-1)

| Unit | Goal | Est. lines | Base |
|------|------|-----------|------|
| WU1 | Session/login deactivation enforcement (2 checkpoints) | ~235 | tracker |
| WU2 | Admin-safety guards + deactivate/reactivate service | ~230 | WU1 |
| WU3 | Forced-password-change flow | ~360 (pre-split 3a/3b if it grows) | WU2 |
| WU4a | Admin user queries + create/update service | ~240 | WU3 |
| WU4b | Admin user-management routes | ~254 | WU4a |
| WU5a | Nav entry + `/users` page + `UsersTable` (list/toggle/deactivate/reactivate) | ~335 | WU4b |
| WU5b | `UserForm` create/edit dialog | ~320 | WU5a |

---

## Work Unit 1 — Session & Login Enforcement

Files: `src/modules/auth/session.ts`(+test), `src/modules/auth/authenticate.ts`(+new test), `src/proxy.ts`(+new test).

- [x] 1.1 RED `session.test.ts` — `isUserActive({deactivatedAt})` truth table; `validateSession` (via new injectable query fn) returns `null` for a deactivated user's row.
- [x] 1.2 GREEN `session.ts` — add `deactivatedAt`/`mustChangePassword` to the `validateSession` projection + `SessionUser` type; add `isUserActive()`; add optional `queryFn` param for DB-free testing.
- [x] 1.3 RED `authenticate.test.ts` (new file) — deactivated user gets the same generic failure as wrong password; active user unaffected.
- [x] 1.4 GREEN `authenticate.ts` — call `isUserActive()`, same `{ok:false}` path, no enumeration.
- [x] 1.5 RED `proxy.test.ts` (new file) — no-token: page redirect / API 401 (existing); invalid session (incl. deactivated): page redirect **and** API 401 (currently missing); valid session forwards `x-user-*` headers.
- [x] 1.6 GREEN `proxy.ts` — mirror the `isApiRoute` branch from the `!token` block onto the `!user` block.
- [x] 1.7 Verify: `can()`/`policy.ts`/`policy.test.ts` untouched — deactivation stays out of the matrix (architecture guard, no code change expected).

**WU1 status: DONE** (commits `b282b60`, `e7e29fb`, `df1133f` on `user-lifecycle/wu1-session-enforcement`, based on tracker `feature/user-lifecycle-management`). Not pushed, no PR opened per instructions — stopped cleanly at the WU1 boundary.

## Work Unit 2 — Admin-Safety Guards + Deactivate/Reactivate Service

Files: `src/modules/account/service.ts`(+test), `src/modules/account/queries.ts`(+test) for `listActiveAdminIds()`.

- [x] 2.1 RED `queries.test.ts` — `listActiveAdminIds()` returns only `role=administrador AND deactivatedAt IS NULL`.
- [x] 2.2 GREEN `queries.ts`.
- [x] 2.3 RED `service.test.ts` — `checkAdminSafety()` truth table: self-role-change, self-deactivate, last-active-admin, deactivated-admin excluded from floor, demoting an already-deactivated admin is a no-op.
- [x] 2.4 GREEN `service.ts` — `checkAdminSafety(input): "self_role_change"|"self_deactivate"|"last_active_admin"|null` per design Decision 7.
- [x] 2.5 RED `service.test.ts` — `deactivateUser()`/`reactivateUser()` call `revokeOtherSessions(targetId, null)` on deactivate only; count-read + write happen inside one injected transaction (assert via mock).
- [x] 2.6 GREEN `service.ts` — wrap in `db.transaction()`; reactivate never invokes `checkAdminSafety`.

**WU2 status: DONE** (commits `e99c4f8`, `1fded37`, and the deactivate/reactivate commit below, on `user-lifecycle/wu2-admin-safety`, based on WU1). Not pushed, no PR opened per instructions — stopped cleanly at the WU2 boundary.

## Work Unit 3 — Forced Password Change Flow

Files: `src/modules/auth/forced-change.ts`(new+test), `src/proxy.ts`(+test), `src/modules/account/service.ts`(+test), `src/app/(app)/change-password/page.tsx`(new), `src/modules/account/ForcedPasswordChangeForm.tsx`(new+test), `src/modules/auth/route-guards.test.ts`.

- [x] 3.1 RED `forced-change.test.ts` — `isPasswordChangeExempt()` true for `CHANGE_PASSWORD_PATH`, `/api/account/password`, `/api/logout`; false otherwise.
- [x] 3.2 GREEN `forced-change.ts` — one exported `CHANGE_PASSWORD_PATH`, `isPasswordChangeExempt()`.
- [x] 3.3 RED `proxy.test.ts` — `mustChangePassword && !exempt`: page → redirect to `CHANGE_PASSWORD_PATH`; API → 403 `password_change_required`; exempt path passes through; gate-precedence test (invalid session never reaches this branch).
- [x] 3.4 GREEN `proxy.ts` — add interception after the existing `!user` check, importing `CHANGE_PASSWORD_PATH`/`isPasswordChangeExempt` (no duplicate constant).
- [x] 3.5 RED `route-guards.test.ts` — regression-pin `/login`, `/api/logout`, `/api/account/password`, `/change-password` as permanently `"session-only"` (closes v1 verify-report W3); register `/change-password`.
- [x] 3.6 GREEN — update `ROUTE_GUARDS`.
- [x] 3.7 RED `service.test.ts` — `changePassword(..., { requireDifferentFromCurrent: true })` rejects `newPassword === currentPassword`, does not clear `mustChangePassword`; unaffected when the flag is unset (self-service unchanged).
- [x] 3.8 GREEN `service.ts` — add optional param; clear `mustChangePassword` in the SAME `UPDATE` as the hash write.
- [x] 3.9 RED `ForcedPasswordChangeForm.test.tsx` (jsdom) — wrong current password shows error; new password equal to temporary shows error; success submits and both fields cleared; logout link present and reachable.
- [x] 3.10 GREEN `ForcedPasswordChangeForm.tsx` + `change-password/page.tsx` (thin RSC wrapper, `"session-only"`).

## Work Unit 4a — Admin User Queries + Service

Files: `src/modules/account/queries.ts`(+test), `src/modules/account/service.ts`(+test).

- [ ] 4a.1 RED `queries.test.ts` — `listUsers({ includeInactive })` active-only by default.
- [ ] 4a.2 GREEN `queries.ts`.
- [ ] 4a.3 RED `service.test.ts` — `createUser()` sets `mustChangePassword: true`, reuses `DuplicateEmailError` (username/email validation, initial password uses same rules as self-service).
- [ ] 4a.4 GREEN `service.ts` — `createUser()`.
- [ ] 4a.5 RED `service.test.ts` — `updateUser()`: name/email/role edits; role→tecnico and deactivate route through `checkAdminSafety` (400 on violation); admin password reset re-arms `mustChangePassword` + calls `revokeOtherSessions(targetId, null)`.
- [ ] 4a.6 GREEN `service.ts` — `updateUser()`.

## Work Unit 4b — Admin User Management Routes

Files: `src/app/api/users/route.ts`(new+test), `src/app/api/users/[id]/route.ts`(new+test), `src/modules/auth/route-guards.test.ts`.

- [ ] 4b.1 RED `route.test.ts` — técnico 403 on GET/POST (no business logic runs); admin GET lists, POST creates, 400 on validation, 409 on duplicate email.
- [ ] 4b.2 GREEN `route.ts` gated `users.manage`.
- [ ] 4b.3 RED `[id]/route.test.ts` — PATCH edit/deactivate/reactivate/password-reset; 400 with the safety-guard reason on last-admin/self violations; 404 on missing user.
- [ ] 4b.4 GREEN `[id]/route.ts`.
- [ ] 4b.5 Register `/api/users`, `/api/users/[id]` in `ROUTE_GUARDS`.

## Work Unit 5a — `/users` Page, Nav Entry, `UsersTable`

Files: `src/modules/layout/nav-items.ts`(+test), `src/app/(app)/users/page.tsx`(new), `src/modules/account/UsersTable.tsx`(new+test).

- [ ] 5a.1 RED `nav-items.test.ts` — admin's `Configuración` group gains "Gestión de usuarios" (`/users`, `users.manage`) as the third child; técnico tree unchanged.
- [ ] 5a.2 GREEN `nav-items.ts` — add the entry; land in the SAME unit as the `/users` route (4b already merged) so no admin ever sees a 404.
- [ ] 5a.3 RED `UsersTable.test.tsx` (jsdom) — "Mostrar inactivos" toggle shows/hides greyed inactive rows with "Reactivar"; active rows show "Desactivar"; last-admin 400 surfaces an inline error, row stays active.
- [ ] 5a.4 GREEN `UsersTable.tsx` — client component, thin `page.tsx` RSC fetches via `listUsers`/`can` and passes props (mirrors `customers/page.tsx`).

## Work Unit 5b — `UserForm` Create/Edit Dialog

Files: `src/modules/account/UserForm.tsx`(new+test), `src/modules/account/UserFormTrigger.tsx`(new).

- [ ] 5b.1 RED `UserForm.test.tsx` (jsdom) — create: username/role required, password field validated client-side (mirrors `PasswordForm.tsx`'s min-length rule); posts `POST /api/users`; 409 duplicate email surfaces inline; edit prefills name/email/role, no password field unless "reset password" is checked.
- [ ] 5b.2 GREEN `UserForm.tsx` (mirrors `CustomerForm.tsx`'s Dialog/state shape) + `UserFormTrigger.tsx` (mirrors `CustomerFormTrigger.tsx`, `router.refresh()` on save).
