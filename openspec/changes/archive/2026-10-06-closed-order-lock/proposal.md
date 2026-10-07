# Proposal: Closed Order Lock with Audited Administrator Correction

## Intent

A `done`/`cancelled` order is already refused to everyone (`edit-policy.ts` D11 → 409; photos → `OrderClosedError`). Two gaps remain: a wrongly-closed order cannot be corrected at all (spec explicitly deferred this "with its own audit story"), and the field gate runs in the route OUTSIDE the write (`updateOrder` re-reads and writes with no status check, no row lock), so it is a convention, not an invariant. Owner decision 2026-10-06: an `administrador` may correct a closed order after re-typing their own password, every change audited.

## Scope

### In Scope
- One server-side guard every order mutation routes through: `SELECT … FOR UPDATE` on the order, then refuse closed unless an admin correction is authorized (generalizes `photos.ts` `lockOpenOrder`).
- Password re-entry verified server-side, in the saving request, against the SESSION user's hash (`verifyPassword`); non-admins refused regardless of password.
- Light throttle: in-memory per-user failure counter (5 failures → 15 min refusal).
- `orden_servicio_correccion` audit table (order id, admin user id, timestamp, field, old, new), written in the same transaction; photo add/delete audited as field `foto`.
- Correction leaves `status`/`completedAt` unchanged; categoria change still replans `service_due`.
- UI: admin sees "Corregir" on closed orders → password dialog → form/photos; others read-only. Responsive, Spanish, 44px, success toast.
- e2e: audit row written; failed correction (bad password, non-admin) leaves no row and no change.

### Out of Scope
- Audit log viewer (trigger: first "who changed this?").
- Work lines (round 2 step 3) — they plug into the same guard.
- Reopening orders; status changes on closed orders.

## Capabilities

### New Capabilities
- `service-order-corrections`: password-gated admin correction of closed orders and its audit trail.

### Modified Capabilities
- `service-orders`: "Order Editing Is Gated by Role and Current Status" (closed row becomes admin-with-password) and "Reception Photos" (closed add/delete allowed under correction).

## Approach

Move the status gate from route into service: `lockOrderForMutation(tx, id, actor, correction?)` returns the locked row or throws; `updateOrder` and photo writes run inside its transaction and diff old/new into audit rows when the order is closed. Routes accept an optional `password` field (JSON / multipart); the route checks throttle, verifies, then passes `correction: { adminId }` down.

Estimate ~1,100 changed lines → chained PRs (feature-branch-chain):
1. Migration + schema + guard + throttle (unit).
2. `updateOrder` under guard + audit + PATCH route + e2e.
3. Photos under guard + audit + e2e.
4. UI: "Corregir" dialog, read-only state, toasts.

## Affected Areas

| Area | Impact |
|------|--------|
| `src/modules/service-orders/{service,photos,edit-policy}.ts` | Modified |
| `src/app/api/service-orders/[id]/**/route.ts` | Modified |
| `src/shared/db/schema.ts` + migration | New table |
| `src/app/(app)/service-orders/[id]/page.tsx`, `ServiceOrderForm`, `OrderPhotos` | Modified |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Guard bypassed by a future writer | Med | Single guard in service; route-guards test |
| Audit SQL unverified (injected seam) | High | e2e rows mandatory |
| In-memory throttle resets on restart | Low | Single-process deployment; noted ceiling |

## Rollback Plan

Revert the chain; the audit table is additive (drop migration). Prior behavior (closed = 409 for all) returns.

## Dependencies

- None external.

## Success Criteria

- [ ] Admin with correct password corrects a closed order; status/completedAt unchanged; audit rows match the diff.
- [ ] Wrong password, non-admin, or throttled → refused, zero rows written (e2e).
- [ ] No mutation path writes a closed order without the guard.

## Proposal question round

Assumptions needing owner review (auto mode):
1. Password per save, no grace window.
2. No mandatory "motivo" text on a correction.
3. Throttle 5/15 min, per user.
4. Photo audit stores photo id as old/new value.
