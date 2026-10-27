# Apply progress: workshop-status-board

## WU1 (branch `feat/workshop-status-board-wu1`) - 1.1-1.10 done, 1.11 partial

### Files changed
- Migration: `src/shared/db/migrations/0035_role_pantalla.sql` (single `ALTER TYPE ... ADD VALUE 'pantalla';`, generated with `npm run db:generate -- --name=role_pantalla`), `meta/_journal.json`, `meta/0035_snapshot.json` (both generated), `src/shared/db/schema.ts`.
- Source: `auth/roles.ts`, `auth/policy.ts` (all-false `pantalla` row, no new Action), `auth/session.ts` (`sessionTtlMs`, `issueSession(userId, role)`), `auth/authenticate.ts`, `auth/landing.ts` (new), `auth/actions.ts`, `app/page.tsx`, `service-orders/edit-policy.ts`, `account/service.ts` (role copy x2).
- Tests: `session`, `authenticate`, `landing` (new), `actions`, `app/page.test.tsx` (new), `policy`, `edit-policy`, `scope`, `roles`, `UserForm`, `UsersTable`, `account/service`, `schema.test.ts` (enum values list updated), `src/e2e/pantalla-role.e2e.test.ts` (new, 9 tests).

### Mutation-verify (reverted fix, named test went red, restored)
- TTL pantalla 180->7: "Lifetime per role - sessionTtlMs() > pantalla gets the lifetime its role calls for"
- landing -> `/inventory`: "Landing per role - landingPathFor() > pantalla lands where its role belongs" and "/ - Landing per role > sends pantalla to /tablero/clientes"
- pantalla cell true: "Matrix row: pantalla is false for every action ..."
- copy dropped in createUser / in updateUser: "Role error copy: rejects an unknown role rather than trusting the caller, in Spanish" / "Role error copy: rejects an unknown role in Spanish, and writes nothing"
- second statement using `'pantalla'` in 0035: e2e "pantalla is a valid role value and a user row with it inserts"
- e2e extras: TTL 7 d -> "session lifetime follows the role ..."; `account.self` granted -> "a forged pantalla is denied every application page and GET /api/users"; reset without revoke and deactivate without revoke -> "deactivation and password reset revoke every session of a pantalla account" (each separately); admin-floor wrapper neutralised -> "with one active administrador and pantalla users ... last_active_admin".

### Gates
- `npm test`: 221 files, 3590 tests passed. `npx tsc --noEmit`: clean. `npm run lint`: 0 errors, 13 warnings.
- e2e (fresh `dforce_e2e`, full suite): 24 files, 320 tests passed, 0 skipped.

### Not done / unchecked
- 1.11 closing steps (GGA, push, PR) left to the orchestrator.
- The spec mentions a role *filter* in the user list; no role filter exists in the code (only selector and badge), so none was touched.
- Pages in e2e (g) are called as functions with forged headers (`next/headers` mocked), not through `proxy.ts`; no browser check (WU4).
- Task 1.3 "order scoping" test passes without code change (pantalla already falls through the technician EXISTS path); it is a regression guard, not a RED.

- WU3 must write the `pantalla` MATRIX row literally when `board.customer` arrives (GGA WU1 note: the `Object.fromEntries` cast disables the missing-grant tsc check).
