# Delta Spec: customer-management (crm-shell-settings-rbac)

The existing spec at `openspec/changes/crm-workshop-management/specs/customer-management/spec.md` (R16-R19) has no access-control requirement — customer routes today rely only on `requireSession()` ("no `can()` sub-gate for v1", per code comment). This is ADDED, not MODIFIED: access does not change for either role, but enforcement moves from implicit-allow to explicit matrix-allow, which is mandatory under default-deny.

## ADDED Requirements

### Requirement: Customer Routes Explicitly Gated

Every customer route (list, create, detail, edit) MUST call `can()` for `customers.read`/`customers.write` after `requireSession()`, even though both roles are granted access. Relying on `requireSession()` alone is insufficient once `can()` defaults to deny.

#### Scenario: Técnico access unchanged

- GIVEN a `tecnico` with a valid session
- WHEN they call any customer route
- THEN `can()` MUST evaluate `true` and the request MUST succeed exactly as it does today

#### Scenario: Administrador access unchanged

- GIVEN an `administrador` with a valid session
- WHEN they call any customer route
- THEN `can()` MUST evaluate `true` and the request MUST succeed

#### Scenario: Gate must be present, not assumed

- GIVEN the default-deny matrix ships
- WHEN a customer route is reviewed
- THEN it MUST contain an explicit `can()` call for `customers.read`/`customers.write` — omitting it would incorrectly 403 a legitimate `tecnico`
