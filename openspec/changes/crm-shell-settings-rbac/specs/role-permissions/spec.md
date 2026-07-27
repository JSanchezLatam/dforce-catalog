# Spec: role-permissions (crm-shell-settings-rbac)

## Purpose

Static, default-deny authorization for the two-role system (`tecnico`, `administrador`). Replaces today's default-allow `can()` (only 3 admin-only actions exist; everything else returns `true`). No DB-backed permission table — a fixed, typed matrix (Round 1 decision #3). This matrix gates purely by ROLE — it has NO concept of account active/inactive state or `must_change_password`. Those are separate, PRIOR gates specified in `user-management` (deactivation denies access regardless of role, including a deactivated `administrador`) and `user-account` (forced password change blocks all other surfaces regardless of role) — this matrix is evaluated only after both of those gates pass.

## Requirements

### Requirement: Two-Role Enum

The system MUST support exactly two roles: `tecnico` (display: "Técnico de taller") and `administrador` (display: "Administrador"). The prior `usuario` enum value MUST be renamed to `tecnico` (not added as a third value) so every existing row already has an explicit matrix entry.

#### Scenario: Existing usuario rows become tecnico

- GIVEN a `users` row with `role = 'usuario'` before this change
- WHEN the migration runs
- THEN its `role` MUST read `tecnico` afterward, with no manual backfill step

### Requirement: Default-Deny Permission Matrix

`can(user, action)` MUST return an explicit boolean for every `(role, action)` pair below. Any action NOT in this table MUST default to `false` for every role (default-deny, reversing today's default-allow).

| Action | Técnico de taller | Administrador |
|---|---|---|
| customers.read | true | true |
| customers.write | true | true |
| service-orders.read | true | true |
| service-orders.write | true | true |
| inventory.read | true | true |
| catalogs.read | true | true |
| catalogs.download | true | true |
| catalogs.generate | **false** | true |
| catalogs.listAll | false | true |
| template.edit | false | true |
| workshop.edit | false | true |
| users.manage | false | true |
| sync.manual | false | true |
| account.self (own profile view/edit) | true | true |

#### Scenario: Técnico denied an admin-only action

- GIVEN a `tecnico` user
- WHEN `can(user, "catalogs.generate")` is evaluated
- THEN it MUST return `false`

#### Scenario: Administrador allowed every action

- GIVEN an `administrador` user
- WHEN `can(user, action)` is evaluated for any action in the table
- THEN it MUST return `true`

#### Scenario: Unlisted action defaults to deny

- GIVEN any role
- WHEN `can(user, action)` is evaluated for an action absent from the table
- THEN it MUST return `false`, not `true`

### Requirement: Server-Side Denial Response

Every route handler or Server Component enforcing an action MUST call `can()` after `requireSession()`. WHEN `can()` returns `false`, the system MUST reject the request with HTTP 403 and a JSON body `{ "error": "Forbidden" }`, before any business logic runs. Authentication (401 for missing/invalid session) is unchanged and out of scope here.

#### Scenario: Técnico calls an admin-only route

- GIVEN a `tecnico` with a valid session
- WHEN they call an endpoint gated on an action where `can()` is `false` for `tecnico`
- THEN the response MUST be `403` with `{ "error": "Forbidden" }`, and no data MUST be mutated

### Requirement: Nav Item Denial Behavior

WHEN a nav item's gating action evaluates `false` for the current user, that item MUST be entirely absent from the rendered item list (not rendered-and-disabled, not rendered-then-hidden via CSS) — same convention as today's `template.edit` gate in `nav-items.ts`.

#### Scenario: Hidden, not disabled

- GIVEN a `tecnico` user
- WHEN the sidebar's nav item list is computed
- THEN items gated on actions denied to `tecnico` MUST NOT appear in the returned array

### Requirement: Matrix Completeness Guard

The test suite MUST assert an explicit expected boolean for every `(Action, Role)` pair (a full cross-product), not a subset. Adding a new `Action` without an entry for every role MUST be a compile-time or test failure — never a silent gap that leaves a route open or a nav item invisibly hidden.

#### Scenario: New action without full role coverage fails tests

- GIVEN a new `Action` is added to the codebase
- WHEN it lacks an explicit boolean for one of the two roles
- THEN the cross-product test suite MUST fail
