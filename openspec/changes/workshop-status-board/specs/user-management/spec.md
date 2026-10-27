# Delta: user-management

Baseline: `openspec/specs/user-management/spec.md` (incomplete; the "Jefe de Taller Is an Assignable Role" requirement is consolidated there). This delta adds one requirement and modifies none by rename. Nothing is removed.

## ADDED Requirements

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

#### Scenario: Admin floor unchanged
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
