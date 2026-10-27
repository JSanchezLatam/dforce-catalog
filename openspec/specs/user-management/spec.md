# Spec: user-management

**This baseline is INCOMPLETE, and that is a known gap, not an oversight in
reading it.** The file was created by `table-redesign-bulk-actions`' archive by
copying that change's delta verbatim — preamble and `## ADDED Requirements`
merge header included — so it holds only the one requirement that change added.
Every other user-management requirement still lives unconsolidated in
`openspec/changes/archive/crm-shell-settings-rbac/specs/user-management/spec.md`
and must be read from there. Consolidating them is its own change.

The stray merge header was removed on 2026-09-09: `## ADDED` / `## MODIFIED`
are instructions for an archiver, consumed rather than copied, and one sitting
in a consolidated baseline makes the spec claim authorship it does not have.

## REQUIREMENTS

### Requirement: Bulk Activate/Deactivate Under the Admin-Floor Invariant

Staff MUST be able to select users in the list view (per
`table-bulk-actions`) and apply a bulk activate or deactivate action.
Because a mixed selection of active and inactive users needs opposite
operations, the UI MUST offer two separate actions — "Activar" and
"Desactivar" — never one action that infers direction per row.

The bulk deactivate action MUST loop the existing `deactivateUser()`
sequentially, one row at a time, exactly as it is called today for a single
row. It MUST NOT read the active-administrator list once and evaluate every
row against that snapshot, because `deactivateUser()` is race-safe only by
re-querying the active-admin count fresh, inside its own transaction, on
every call (`account/service.ts:454-479`). A batched read would let a
selection containing every administrator pass every row's check against a
not-yet-decremented count and leave the workshop with zero administrators.
This extends the existing "Last Active Administrador Cannot Be Removed"
requirement to the bulk path without changing that requirement's rule.

#### Scenario: Selecting every remaining admin deactivates exactly one
- GIVEN exactly 2 active administrators and no other selected users
- WHEN staff selects both and runs "Desactivar"
- THEN the system MUST deactivate exactly one of them and refuse the second with `last_active_admin`, leaving at least one administrator active

#### Scenario: Mixed selection uses the matching button only
- GIVEN a selection containing both active and inactive users
- WHEN staff clicks "Desactivar"
- THEN only the active users in the selection MUST be affected; the already-inactive ones MUST be reported as a no-op, not a failure

#### Scenario: Self-inclusion is refused per row, not for the whole batch
- GIVEN a selection that includes the acting administrator's own account among 4 others
- WHEN staff runs "Desactivar"
- THEN the other rows MUST be processed normally and the acting administrator's own row MUST be refused with `self_deactivate`

*Verification*: `deactivateUser()`'s transaction is exercised only through an
injected `database`/`listActiveAdminIds` seam in unit tests — per AGENTS.md,
a green suite here proves zero coverage of the real transaction's
row-locking behavior. The admin-floor scenario above MUST additionally be
run against a throwaway Postgres database before merge, confirming that
selecting both remaining admins together still leaves exactly one active.

### Requirement: Jefe de Taller Is an Assignable Role

An `administrador` MUST be able to create a user with, and change a user to, the role `jefe_taller`, in the same user create and edit paths and bulk lists that serve the existing roles. The role selector and the role badge MUST show "Jefe de taller" (the user list has no role filter). Existing guards (last active administrador cannot be removed, self-deactivation refused) MUST be unchanged and MUST continue to count only `administrador` as the protected floor. Because `jefe_taller` lacks `users.manage`, it MUST NOT reach any user-management route or screen.

#### Scenario: Administrador creates a jefe
- GIVEN an `administrador` session
- WHEN they create a user with role `jefe_taller`
- THEN the user MUST be created with that role

#### Scenario: Jefe cannot manage users
- GIVEN a `jefe_taller` session
- WHEN it calls any users route
- THEN the system MUST answer 403

#### Scenario: Admin floor unchanged
- GIVEN exactly one active `administrador` and any number of active `jefe_taller` users
- WHEN that administrador is deactivated or demoted
- THEN the system MUST refuse with `last_active_admin`

### Requirement: A Tecnico Login Gets a Linked Roster Row

When a user is created with the role `tecnico`, or an existing user is changed to `tecnico`, the system MUST, in the same transaction, create a roster row named from the user and linked to that user, unless a roster row already links to that user (then it MUST reuse it, creating nothing). A failure creating the row MUST roll back the user change. Changing a user away from `tecnico`, or deactivating the user, MUST NOT delete, unlink or deactivate the roster row and MUST NOT touch its assignments or work lines; a técnico-less login simply sees no assigned orders.

#### Scenario: New técnico user gets a row
- GIVEN an `administrador` creates a user with role `tecnico`
- WHEN the save succeeds
- THEN exactly one roster row linked to that user MUST exist

#### Scenario: Promotion to técnico reuses an existing link
- GIVEN a user with an existing linked roster row who is changed to `tecnico`
- WHEN the save succeeds
- THEN no second row MUST be created

#### Scenario: Atomic with the user
- GIVEN a roster insert that fails
- WHEN a técnico user create runs
- THEN the user MUST NOT be created

#### Scenario: Demotion keeps the roster row
- GIVEN a `tecnico` user with assignments
- WHEN an administrador changes them to `jefe_taller`
- THEN the roster row, its link and its assignments MUST remain

### Requirement: Pantalla Is an Assignable Role

An `administrador` MUST be able to create a user with, and change a user to, the role `pantalla` (a read-only account for the big screens, see `workshop-status-board`), through the same user create and edit paths and list that serve the existing roles. The role selector and the role badge MUST show "Pantalla" (the user list has no role filter). The Spanish validation message that lists the allowed roles, in both `createUser` and `updateUser` in `modules/account/service.ts`, MUST name every assignable role including `pantalla`: "El rol debe ser técnico, jefe de taller, pantalla o administrador." An unknown role MUST still be rejected with that message.

The role `pantalla` MUST NOT hold `users.manage`, so it MUST NOT reach any user-management route or screen, and MUST NOT hold `account.self`. Existing guards (last active administrador cannot be removed, self-deactivation refused) MUST be unchanged and MUST continue to count only `administrador` as the protected floor. A `pantalla` user MUST NOT get a technician roster row: roster creation stays gated on `tecnico` only. Changing a user to or from `pantalla` MUST NOT touch any roster row. Deactivating a `pantalla` user, or resetting its password, MUST revoke its sessions like any other role.

The database enum MUST gain the value `pantalla` by a migration that does not use the new value in the same migrate transaction.

#### Scenario: Administrador creates a pantalla user
- GIVEN an `administrador` session
- WHEN they create a user with role `pantalla`
- THEN the user MUST be created with that role, `mustChangePassword` true, and no roster row **[e2e]**

#### Scenario: Role selector and badge
- GIVEN the user form and list
- WHEN rendered
- THEN each MUST offer or show "Pantalla" **[unit]**

#### Scenario: Role error copy names pantalla
- GIVEN a create or edit with an unknown role
- WHEN validation runs
- THEN the error MUST read "El rol debe ser técnico, jefe de taller, pantalla o administrador." in both paths **[unit]**

#### Scenario: Pantalla cannot manage users
- GIVEN a `pantalla` session
- WHEN it calls any users route
- THEN the system MUST answer 403 **[e2e]**

#### Scenario: Pantalla does not lower the admin floor
- GIVEN exactly one active `administrador` and any number of active `pantalla` users
- WHEN that administrador is deactivated or demoted
- THEN the system MUST refuse with `last_active_admin` **[e2e]**

#### Scenario: Switching to pantalla creates no roster row
- GIVEN an existing user who is not a `tecnico`
- WHEN an administrador changes them to `pantalla`
- THEN no roster row MUST be created **[e2e]**

#### Scenario: Enum migration applies
- GIVEN a database at the previous migration
- WHEN migrations run
- THEN `pantalla` MUST be a valid `role` value and a user row with it MUST insert **[e2e]**
