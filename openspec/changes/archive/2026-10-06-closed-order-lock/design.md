# Design: Closed Order Lock with Audited Administrator Correction

## Technical Approach

Move the status gate from the route (`[id]/route.ts:57-78`, unlocked read, separate write) into the service. A new `order-lock.ts` generalizes `photos.ts#lockOpenOrder`: lock the order row with `SELECT … FOR UPDATE`, then either refuse it or return it. Every order writer calls the lock inside its transaction. The route authenticates a correction BEFORE the lock: throttle first, then bcrypt, then a `CorrectionGrant` passed down. Audit rows are inserted in the same transaction as the write. Reminder side effects stay after commit, the same rule `createOrder` follows.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Guard shape | `lockOrderForMutation(tx, id, { canWrite, correction? })`: each mutation passes its own predicate; the guard owns the lock and the closed/correction rule | One guard per mutation kind | Work lines (the technicians change) plug in by passing `canEditWorkLines` |
| `transitionOrder` | Runs under the same lock with `canWrite: () => true`; `assertTransition` stays its gate | Leave it unlocked | The read-then-write race lets "cancel" overwrite a concurrent "done". Closed→X stays a 400 `invalid_transition`, unchanged |
| Password verify placement | Route, outside the transaction, only on OrderClosedError | Inside the transaction | bcrypt cost 12 must not hold the row lock (same reason as `updateUser` hashing outside its transaction); route attempts the write first, and only calls `authorizeCorrection` and retries on OrderClosedError with password present and `service-orders.correct` held; a password sent with an open-order edit is never verified and never counts toward the throttle |
| Authority for the role | `role`, `deactivatedAt` and `passwordHash` come from ONE `users` SELECT by session id; `can(user, "service-orders.correct")` gives the early 403 | Trust the `x-user-role` header alone | The header is a claim; the DB read costs nothing extra |
| New Action | `service-orders.correct` (admin only), declared as an array entry in `ROUTE_GUARDS` next to the existing action | Reuse `deletePhoto` | Keeps the route-guard cross-reference test meaningful |
| Throttle | Module-level `Map<userId, number[]>` of failure timestamps; at 5 failures inside 15 min, refuse until the oldest failure ages out; a success clears the entry; checked BEFORE bcrypt | DB table | Single-process deployment. `ponytail:` resets on restart; move to a table if the app ever runs more than one process |
| Audit FKs | `orden_id` and `user_id` both use `restrict` | Use `cascade` | ADR-6 protects history. No delete path exists for either table |
| Value encoding | `text`: Date → ISO string, number → `String()`, null → NULL; photo add is `(null, photoId)`, photo delete is `(photoId, null)` | `jsonb` | No viewer exists yet. Plain text reads directly in psql |
| Unchanged fields | Diff from the LOCKED row; only fields that changed get an audit row | One row per sent field | The form re-sends every field |

Status codes: closed order without a password → 409 (unchanged). Wrong password → 403 `{ error: "wrong_password" }`. Throttled → 429 with `Retry-After`. Técnico → 403 before any lookup. A password sent for an open order is ignored and writes no audit row.

## Data Flow

    PATCH/POST/DELETE ─→ can(write|deletePhoto) ─→ service: tx { lockOrderForMutation ─→ write ─→ insert correccion rows }
                         ─→ on OrderClosedError, if password + correct? ─→ authorizeCorrection (throttle → users SELECT → bcrypt) ─→ grant ─→ service: tx { lockOrderForMutation ─→ write ─→ insert correccion rows }
    ─→ commit ─→ reminder replan (categoria/appointmentAt), after commit

## File Changes

| File | Action | Description |
|---|---|---|
| `src/shared/db/migrations/0027_orden_servicio_correccion.sql` + `meta/` | Create | Audit table |
| `src/shared/db/schema.ts` | Modify | `ordenServicioCorreccion` |
| `src/modules/service-orders/order-lock.ts` | Create | Guard, `OrderClosedError` (moved), `OrderEditForbiddenError`, `recordCorrections(tx, …)` |
| `src/modules/service-orders/correction-auth.ts` | Create | `authorizeCorrection` + throttle |
| `src/modules/service-orders/service.ts` | Modify | `updateOrder`/`transitionOrder` under the guard; diff → audit |
| `src/modules/service-orders/photos.ts` | Modify | Use the guard, audit `foto`; re-export `OrderClosedError` |
| `src/modules/service-orders/edit-policy.ts` | Modify | `isClosedStatus` |
| `src/modules/auth/policy.ts`, `route-guards.test.ts` | Modify | New Action |
| `src/app/api/service-orders/[id]/route.ts`, `photos/route.ts`, `photos/[photoId]/route.ts` | Modify | Optional `password` (JSON / multipart / DELETE JSON body); route pre-check removed |
| `src/app/(app)/service-orders/[id]/page.tsx` | Modify | "Corregir" for admins on closed orders |
| `ServiceOrderForm.tsx`, `ServiceOrderFormTrigger.tsx`, `OrderPhotos.tsx` | Modify | Correction mode; shared `CorrectionPasswordField` |

## Interfaces / Contracts

```ts
export type CorrectionGrant = { correctorId: string };
export function lockOrderForMutation(
  tx: Tx, id: string,
  opts: { canWrite: (s: OrderStatus) => boolean; correction?: CorrectionGrant },
): Promise<{ order: OrdenServicio; correcting: boolean }>;
// not found → OrdenServicioNotFoundError; canWrite false + closed + grant → correcting;
// closed without grant → OrderClosedError; otherwise → OrderEditForbiddenError
export function authorizeCorrection(userId: string, password: string, deps?):
  Promise<CorrectionGrant>; // throws CorrectionRefusedError("throttled"|"wrong_password"|"not_admin")
```

`status` and `completedAt` are not in `UpdateOrdenServicioPatch`, so a correction cannot write them. A test pins this.

## UI

Admin on a closed order: a "Corregir" button (`min-h-11 min-w-11`) opens `ServiceOrderForm` in correction mode. The form embeds `CorrectionPasswordField` — a `type="password"` field with `autoComplete="current-password"` and the label "Tu contraseña". The password lives in component state and is cleared on close; it is required again on every save. For photo add and delete confirmations on a closed order, each confirmation embeds the same password field. Errors stay inline ("Contraseña incorrecta", "Demasiados intentos. Probá de nuevo en 15 minutos."). Success: `addToast("success", "Orden corregida")` above `router.refresh()`, below the try/catch. The dialog is full-width on mobile and the inputs keep their `pointer-coarse:` 44px. No secure-context API is used: no crypto and no clipboard on the client.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | Guard branches, throttle window (injected `now`), diff encoding, route status codes | Fake tx (`photos.test.ts` style); every fix mutation-verified |
| E2E (`order-corrections.e2e.test.ts`) | Correction writes the fields plus exact audit rows, status/completedAt unchanged; audit-insert failure (nonexistent `correctorId` → real FK violation) rolls back the UPDATE; wrong password / técnico through the real handler → zero rows; photo add/delete audited; the failing put rolls back the audit row | Real Postgres `dforce_e2e` |
| Manual | Dialog over LAN IP on a tablet | Browser, `http://<ip>:3000` |

## Threat Matrix

N/A: no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

Additive table, number 0027. **Renumber risk**: `plate-municipio` takes 0026. Generate this migration only after rebasing onto its merge, otherwise the `_journal.json` and `prevId` chain conflict. If this change lands first, `plate-municipio` renumbers instead. Rollback: revert the chain and drop the table.

Work units (feature-branch chain):

| WU | Scope | Est. lines |
|---|---|---|
| 1 | Migration, schema, `order-lock.ts`, `correction-auth.ts`, Action, unit tests | ~390 |
| 2 | `updateOrder` + `transitionOrder` under the guard, PATCH route, e2e | ~400 (if over budget, move `transitionOrder` to WU3) |
| 3 | Photos under the guard + audit, both routes, e2e | ~270 |
| 4 | UI: Corregir, password field, photos, toasts, component tests | ~360 |

## Open Questions

None blocking.
