# Delta Spec: user-management

The baseline `openspec/specs/user-management/spec.md` is incomplete (see its preamble), so this delta only ADDS requirements; it does not restate the unconsolidated requirements of `crm-shell-settings-rbac`.

## ADDED Requirements

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
