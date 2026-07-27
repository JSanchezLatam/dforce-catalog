# Spec: user-account (crm-shell-settings-rbac)

## Purpose

Self-service account settings reachable from the sidebar footer: view profile, edit `name`/`email`, change password. `username` stays immutable in v1. Round 3 decision #11 adds a forced password-change flow for admin-created users (`must_change_password` flag) — this REVERSES the earlier "no forced change" assumption and is reconciled below with the existing session-revocation rule.

## Requirements

### Requirement: Self-Service Profile View

Any authenticated user MUST be able to view their own `username` (read-only), `name`, and `email` (each possibly empty).

#### Scenario: View own profile

- GIVEN a logged-in user
- WHEN they open `/account`
- THEN the system MUST show their current `username`, `name`, and `email`

### Requirement: Profile Edit — Name and Email Only

A user MUST be able to edit their own `name` and `email`. `username` MUST NOT be editable through this surface, even if a tampered request includes a new value.

#### Scenario: Edit name and email

- GIVEN a user submits a new `name` and `email`
- WHEN valid
- THEN the system MUST persist both fields

#### Scenario: Username change ignored

- GIVEN a request includes a changed `username` value
- WHEN processed
- THEN the system MUST ignore it — `username` MUST remain unchanged

### Requirement: Email Validation

`email`, when provided, MUST match a standard email format and MUST be unique across users.

#### Scenario: Invalid format

- GIVEN `email = "not-an-email"`
- WHEN submitted
- THEN the system MUST reject it with a validation error

#### Scenario: Duplicate email

- GIVEN another user already has `email = "a@b.com"`
- WHEN a different user attempts to save `email = "a@b.com"` as their own
- THEN the system MUST reject it as a duplicate

#### Scenario: Unchanged own email not flagged

- GIVEN a user's current email is `email = "a@b.com"`
- WHEN they resubmit the form without changing the email
- THEN the system MUST NOT flag it as a duplicate of itself

### Requirement: Password Change with Current-Password Confirmation

A password change MUST require the correct current password. WHEN the current password is incorrect, the system MUST reject the change and MUST NOT alter the stored password hash.

#### Scenario: Correct current password

- GIVEN a user supplies the correct current password and a new password
- WHEN submitted
- THEN the system MUST update the password hash

#### Scenario: Incorrect current password

- GIVEN a user supplies an incorrect current password
- WHEN submitted
- THEN the system MUST reject the change and leave the stored password hash unchanged

### Requirement: Session Revocation on Password Change

WHEN a password change succeeds, the system MUST revoke every OTHER active session belonging to that user (set `revokedAt`). The session that performed the change MUST remain active — the user is not logged out of their own tab. This rule applies UNIFORMLY whether the change is self-initiated (this requirement) or a forced first-login change (see "Forced Password Change on First Login" below) — there is no special case for the forced flow.

#### Scenario: Other sessions revoked

- GIVEN a user has two active sessions (tab A performing the change, tab B elsewhere)
- WHEN the password change succeeds from tab A
- THEN tab B's session MUST be revoked

#### Scenario: Current session survives

- GIVEN a user changes their password from the current session
- WHEN the change succeeds
- THEN that same session MUST remain active and usable

### Requirement: Forced Password Change on First Login

(Reconciles Round 3 decision #11 with the two requirements above — same underlying password-change action, with an additional access block layered on top.)

WHEN a user's `must_change_password` flag is `true` (set at creation by an admin, or re-armed by an admin password reset — see `user-management`), the system MUST deny every request to any surface OTHER than the forced-change screen and logout, regardless of the user's role or what the permission matrix would otherwise allow. This check MUST run before role-based authorization.

#### Scenario: Técnico blocked from a normally-permitted surface

- GIVEN a `tecnico` with `must_change_password = true`
- WHEN they request `/inventory` (normally allowed for técnico)
- THEN the system MUST deny it and redirect to the forced-change screen

#### Scenario: Administrador also blocked

- GIVEN an `administrador` with `must_change_password = true`
- WHEN they request any surface other than the forced-change screen
- THEN the system MUST deny it, even though their role would otherwise grant everything

### Requirement: Forced-Change Screen Stays Reachable

The forced-change screen itself, and the logout action, MUST remain reachable while `must_change_password` is `true` — the block above MUST NOT be absolute, or the user could never clear the flag.

#### Scenario: Change-password screen reachable while blocked

- GIVEN a user with `must_change_password = true`
- WHEN they request the forced-change screen
- THEN the system MUST allow it

#### Scenario: Logout reachable while blocked

- GIVEN a user with `must_change_password = true`
- WHEN they request logout
- THEN the system MUST allow it

### Requirement: New Password Must Differ From the Temporary One

The forced change MUST require the user's current (temporary) password, same as "Password Change with Current-Password Confirmation" above. The new password MUST NOT equal the current temporary password — accepting an unchanged password would defeat the purpose of forcing rotation.

#### Scenario: New password same as temporary — rejected

- GIVEN a user submits a "new" password identical to their current temporary password
- WHEN submitted
- THEN the system MUST reject it and MUST NOT clear `must_change_password`

#### Scenario: New password different — accepted

- GIVEN a user submits a new password different from the temporary one, with the correct temporary password as confirmation
- WHEN submitted
- THEN the system MUST update the password hash and clear `must_change_password`

### Requirement: Flag Clears Immediately on Successful Forced Change

WHEN the forced password change succeeds, `must_change_password` MUST clear to `false` BEFORE the user is granted access to any other surface. The same session-revocation rule as any other password change applies (other sessions revoked, current session survives).

#### Scenario: Flag clears and access unblocks

- GIVEN a user successfully completes the forced password change
- WHEN the change is saved
- THEN `must_change_password` MUST become `false` and the user MUST regain access to every surface their role permits

### Requirement: Email Change Does Not Revoke Sessions

Changing `email` alone (no password change) MUST NOT revoke any session.

#### Scenario: Email-only change

- GIVEN a user changes only their email
- WHEN saved
- THEN no session MUST be revoked
