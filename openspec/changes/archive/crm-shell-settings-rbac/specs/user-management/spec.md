# Spec: user-management (crm-shell-settings-rbac)

## Purpose

Admin-only screen to create, edit, and deactivate/reactivate users (Round 2 decision #7 introduced this capability; Round 3 decision #10 REVERSES the earlier create-only scope to CREATE + EDIT + DEACTIVATE). "Gestión de usuarios" renders inside the `Configuración` nav group (Round 3 decision #9 — see `app-navigation`).

## Requirements

### Requirement: Admin-Only Access

Access to user management MUST be gated on the `users.manage` action (administrador: true, técnico: false — see `role-permissions`). A `tecnico` requesting this surface directly MUST receive the same denial behavior as any other admin-only action.

#### Scenario: Técnico denied

- GIVEN a `tecnico` user
- WHEN they request the user-management route/action directly
- THEN the system MUST deny it (403 for the underlying action; the route MUST NOT execute business logic)

#### Scenario: Nav entry hidden from Técnico

- GIVEN a `tecnico` user
- WHEN the sidebar renders
- THEN no "Gestión de usuarios" nav item MUST appear inside the Configuración group (see `app-navigation`)

### Requirement: User Creation with Role Assignment

An Administrador MUST be able to create a new user by providing `username`, `role` (`tecnico` or `administrador`), and MAY provide `name` and `email` at creation time.

#### Scenario: Create a técnico with prefilled email

- GIVEN an Administrador submits `username`, `role = "tecnico"`, `name`, and `email`
- WHEN valid
- THEN the system MUST create the user with all four fields set

#### Scenario: Create without optional fields

- GIVEN an Administrador submits only `username` and `role`
- WHEN valid
- THEN the system MUST create the user with `name`/`email` left unset

### Requirement: Initial Password — Admin-Entered, Forced Change on First Login

(Previously: no forced change was required — REVERSED by Round 3 decision #11.)

The Administrador MUST set the new user's initial password directly at creation time (admin-entered, not a system-generated temporary password). Every newly created user MUST have `must_change_password = true`, forcing them to set a new password on first login before reaching any other surface (full forced-change behavior specified in `user-account`).

*Rationale: the admin must not know the técnico's real password indefinitely. An email-invitation-with-token flow was considered and rejected — it requires a tokens table, expiry logic, and an email template, costing a whole extra PR; the forced-change flag achieves the same security goal at far lower cost.*

#### Scenario: Admin sets initial password, forced change required

- GIVEN an Administrador creates a user and supplies a password
- WHEN that user logs in for the first time
- THEN the system MUST set `must_change_password = true` at creation and block the user from every surface except the forced-change screen until they set a new password

### Requirement: Editing an Existing User

An Administrador MUST be able to edit an existing user's `name`, `email`, and `role`. Changing `role` MUST take effect on the user's NEXT request evaluation (their existing sessions are not automatically revoked by a role change alone).

#### Scenario: Edit name and email

- GIVEN an Administrador edits an existing user's `name` and `email`
- WHEN valid
- THEN the system MUST persist the changes

#### Scenario: Promote a técnico to administrador

- GIVEN an existing `tecnico` user
- WHEN an Administrador changes their `role` to `administrador`
- THEN subsequent permission checks for that user MUST use the new role

### Requirement: Admin Password Reset Re-Arms Forced Change

WHEN an Administrador resets another user's password (as part of editing that user), the system MUST set `must_change_password = true` for that user again, regardless of its prior value.

#### Scenario: Admin resets a user's password

- GIVEN an Administrador sets a new password for an existing user
- WHEN the reset is saved
- THEN `must_change_password` MUST become `true`, forcing that user through the change-password flow on their next login

### Requirement: Deactivation Is Soft, Never Delete

An Administrador MUST be able to deactivate an existing user, setting their `active` status to `false`. Deactivation MUST NOT delete the user row. A deactivated user MUST be reactivatable by an Administrador, restoring `active = true`.

*Rationale: historical `orden_servicio.createdBy` references a `users.id` — hard delete would break referential integrity or require nulling attribution history. Soft-deactivate preserves both.*

#### Scenario: Deactivate a user

- GIVEN an active user
- WHEN an Administrador deactivates them
- THEN the system MUST set `active = false` and MUST NOT remove the user row

#### Scenario: Reactivate a user

- GIVEN a deactivated user
- WHEN an Administrador reactivates them
- THEN the system MUST set `active = true`, restoring their normal access per their role

### Requirement: Deactivation Denies Access Regardless of Role

The permission matrix (`role-permissions`) gates purely by ROLE and has no concept of account state. Active/inactive status MUST be enforced as a separate, prior gate: a deactivated user — INCLUDING a deactivated `administrador` — MUST be denied access to every surface, even though their role would otherwise grant it. A deactivated user's existing sessions MUST be treated as invalid immediately (equivalent to a revoked session): their next request MUST receive the same response as an expired/revoked session (redirect to `/login` for page navigations, 401 JSON for API routes), not merely a 403 from the permission matrix.

#### Scenario: Deactivated administrador still denied

- GIVEN a deactivated `administrador` with a previously valid session
- WHEN they make any request
- THEN the system MUST deny it exactly as it would an expired/revoked session, despite their role granting everything

#### Scenario: Deactivation takes effect immediately

- GIVEN an active user with an open session
- WHEN an Administrador deactivates them
- THEN that user's NEXT request MUST be denied, without waiting for session expiry

### Requirement: Last Active Administrador Cannot Be Removed

The system MUST NOT allow the last active `administrador` to be deactivated or demoted to `tecnico` — by another admin OR by themselves (self-deactivation/self-demotion included). The system MUST reject such an attempt with a validation error rather than silently no-op.

#### Scenario: Cannot deactivate the only admin

- GIVEN exactly one active `administrador` exists
- WHEN any Administrador attempts to deactivate that account
- THEN the system MUST reject it, leaving the account active

#### Scenario: Cannot demote the only admin

- GIVEN exactly one active `administrador` exists
- WHEN an attempt is made to change that account's role to `tecnico`
- THEN the system MUST reject it, leaving the role as `administrador`

#### Scenario: Deactivation allowed when another admin remains

- GIVEN two active `administrador` accounts exist
- WHEN one is deactivated
- THEN the system MUST allow it, since at least one active administrador remains

### Requirement: Deactivated Users Remain Visible and Attributable

A deactivated user MUST still appear in the user-management listing, visibly marked as inactive (not hidden or filtered out by default). A deactivated user MUST remain attributable on historical `orden_servicio` records they created — `createdBy` MUST NOT be nulled or anonymized on deactivation.

#### Scenario: Deactivated user still listed

- GIVEN a deactivated user
- WHEN an Administrador opens the user-management listing
- THEN that user MUST still appear, marked as inactive

#### Scenario: Historical attribution preserved

- GIVEN a deactivated user who previously created service orders
- WHEN those service orders are viewed
- THEN `createdBy` MUST still reference that user, unchanged by their deactivation
