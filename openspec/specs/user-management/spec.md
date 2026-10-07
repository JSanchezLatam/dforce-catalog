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

An `administrador` MUST be able to create a user with, and change a user to, the role `jefe_taller`, in the same user create and edit paths and bulk lists that serve the existing roles. The role selector, the role badge and the list filter MUST show "Jefe de taller". Existing guards (last active administrador cannot be removed, self-deactivation refused) MUST be unchanged and MUST continue to count only `administrador` as the protected floor. Because `jefe_taller` lacks `users.manage`, it MUST NOT reach any user-management route or screen.

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
