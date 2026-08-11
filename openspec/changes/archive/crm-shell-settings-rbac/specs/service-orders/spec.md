# Delta Spec: service-orders (crm-shell-settings-rbac)

The existing spec at `openspec/changes/crm-workshop-management/specs/service-orders/spec.md` (R20-R22) has no access-control requirement. This is ADDED, not MODIFIED: access does not change for either role, but enforcement moves from implicit-allow to explicit matrix-allow, mandatory under default-deny.

## ADDED Requirements

### Requirement: Service Order Routes Explicitly Gated

Every service-order route (list, create, detail, status transition) MUST call `can()` for `service-orders.read`/`service-orders.write` after `requireSession()`.

#### Scenario: Técnico access unchanged

- GIVEN a `tecnico` with a valid session
- WHEN they call any service-order route
- THEN `can()` MUST evaluate `true` and the request MUST succeed exactly as it does today

#### Scenario: Administrador access unchanged

- GIVEN an `administrador` with a valid session
- WHEN they call any service-order route
- THEN `can()` MUST evaluate `true` and the request MUST succeed

#### Scenario: Gate must be present, not assumed

- GIVEN the default-deny matrix ships
- WHEN a service-order route is reviewed
- THEN it MUST contain an explicit `can()` call — omitting it would incorrectly 403 a legitimate `tecnico`
