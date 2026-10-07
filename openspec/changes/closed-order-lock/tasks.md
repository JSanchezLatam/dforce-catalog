# Tasks: Closed Order Lock with Audited Administrator Correction

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,420 total (tests ~55%): WU1 ~390, WU2 ~400, WU3 ~270, WU4 ~360; migration SQL and `meta/` snapshot excluded |
| 400-line budget risk | High (WU1 and WU2 sit at the line; WU2 spills over if `transitionOrder` stays in it) |
| Chained PRs recommended | Yes |
| Suggested split | Tracker draft branch `feat/closed-order-lock` off `main`; WU1 base = tracker; WU2 base = WU1 branch; WU3 base = WU2 branch; WU4 base = WU3 branch; tracker merges to `main` last |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Audit table, guard, throttle, `service-orders.correct` Action (no caller yet) | PR 1 (base: tracker) | `npx vitest run src/modules/service-orders src/modules/auth src/app/api/route-guards.test.ts` | e2e on throwaway `dforce_e2e` (migration applies, FK `restrict`) | Revert PR 1; 0027 additive, nothing calls the guard |
| 2 | `updateOrder` + `transitionOrder` under the guard, audit diff, PATCH route | PR 2 (base: WU1 branch) | `npx vitest run src/modules/service-orders src/app/api/service-orders` | `src/e2e/order-corrections.e2e.test.ts` on `dforce_e2e`; curl at LAN IP | Revert PR 2; closed = 409 for all returns, photos unaffected |
| 3 | Photos under the guard + `foto` audit, both photo routes | PR 3 (base: WU2 branch) | `npx vitest run src/modules/service-orders/photos.test.ts src/app/api/service-orders` | e2e rows on `dforce_e2e` (put injected); curl as both roles | Revert PR 3; photos return to `lockOpenOrder` |
| 4 | UI: Corregir, password field, photos, toasts, read-only state | PR 4 (base: WU3 branch) | `npx vitest run src/modules/service-orders "src/app/(app)/service-orders"` | Playwright at `http://192.168.0.3:3000`, 390 / 768 / desktop, both roles | Revert PR 4; API stays, no UI offers it |

Rule for every task pair: RED test, confirm red BY NAME, GREEN, then mutation-verify (revert the fix, the named test goes red). Fixtures match the wire. Migration comes from `drizzle-kit generate --name orden_servicio_correccion`, never hand-written; read the generated SQL. Workshop note (in WU1 PR description): the workshop must run `standalone.ps1` to apply 0027 (additive). E2E rows run on a throwaway `dforce_e2e`, never the dev DB. Gates per PR: `npx tsc --noEmit`, `npm test`, `npm run lint` (0 errors, 14 warnings), `gga run --pr-mode --diff-only` with `PR_BASE_BRANCH` pinned to the previous branch. Owner standing consent covers all Gentle AI reviews. Threat matrix: N/A (design).

## WU1: Table, guard, throttle (PR 1)

- [x] 1.0 PRECONDITION: `plate-municipio` (0026) is merged to `main`. Create the tracker off updated `main`, confirm `ls src/shared/db/migrations` ends at 0026, only then generate 0027. If not merged, STOP (WU1 is blocked, not renumbered).
- [x] 1.1 `schema.ts`: `ordenServicioCorreccion(id, orden_id FK restrict, user_id FK restrict, created_at, field text, old_value text null, new_value text null)`. `drizzle-kit generate --name orden_servicio_correccion` (0027); confirm both `restrict` in the SQL.
- [x] 1.2 RED `edit-policy.test.ts`: `isClosedStatus` true for done/cancelled, false for open/in_progress (exhaustive `Record<OrderStatus, boolean>`). GREEN `edit-policy.ts`.
- [x] 1.3 RED `policy.test.ts`: `service-orders.correct` administrador true, tecnico false. GREEN `policy.ts`. (Guard rows moved to 2.3 / 3.2: the cross-reference test needs a real `can(user, "service-orders.correct")` in the route, which only exists from WU2/WU3.)
- [x] 1.4 RED `order-lock.test.ts` (fake tx, `photos.test.ts` style): not found throws `OrdenServicioNotFoundError`; open + `canWrite` true returns `correcting:false`; closed + `canWrite` false + grant returns `correcting:true`; closed without grant throws `OrderClosedError`; open + `canWrite` false throws `OrderEditForbiddenError`; closed + `canWrite` true (transition) passes through; lock query is `FOR UPDATE`. GREEN `order-lock.ts` (`OrderClosedError` moved).
- [x] 1.5 RED `order-lock.test.ts`: `recordCorrections` encodes Date as ISO, number via `String()`, null as NULL; writes one row per CHANGED field only; no change writes nothing. GREEN.
- [x] 1.6 RED `correction-auth.test.ts` (injected `now`, users lookup, `verifyPassword`): técnico throws `not_admin` and bcrypt is never called; deactivated user refused; wrong password throws `wrong_password`; other admin's password refused (hash is the session user's); 5th failure refused as wrong, then correct password throws `throttled` without verifying; window expiry accepts; success clears; per-user isolation; throttle checked BEFORE bcrypt. GREEN `correction-auth.ts` (`ponytail:` comment: in-memory, single process).
- [x] 1.7 Mutation-verify 1.2-1.6 by name (drop `.for("update")`, check throttle after bcrypt, read hash from the wrong user, skip the diff filter).

## WU2: updateOrder and transitionOrder under the guard (PR 2)

- [x] 2.1 RED `service.test.ts`: `updateOrder` runs inside the lock; stale-status trap (status read from the locked row, not a prior read); closed + grant writes fields and audit rows in one tx; `status`/`completedAt` never in `UpdateOrdenServicioPatch` and a body `status` is ignored; open edit writes no audit row; categoria change still replans `service_due` AFTER commit. GREEN `service.ts`.
- [ ] 2.2 MOVED to WU3 as task 3.0 (design rule: WU2 already measured ~700 changed lines without it, 432 added/271 deleted in tracked files plus 183 in the new e2e file, so `transitionOrder` under the lock would not fit). `transitionOrder` is unchanged in WU2.
- [x] 2.3 RED PATCH `[id]/route.test.ts`: técnico + password on closed 403 and `authorizeCorrection` never verifies; admin no password on closed 409; wrong password 403 `{error:"wrong_password"}`; throttled 429 with `Retry-After`; correct password 200; password on open order ignored, no audit row; route pre-check at `[id]/route.ts:57-78` removed; `route-guards.test.ts` lists `service-orders.correct` beside `write` on PATCH `[id]` and the temporary `exempt` entry for it is removed; `OrderClosedError` no longer says "no se pueden cambiar sus fotos" (generic closed-order message, photo route/UI tests updated). GREEN route.
- [x] 2.4 RED e2e `src/e2e/order-corrections.e2e.test.ts` (`dforce_e2e`): correction writes fields plus exact audit rows, `status`/`completedAt` unchanged; nonexistent `correctorId` (real FK violation) rolls back the UPDATE; wrong password and técnico through the real handler leave zero rows and no change; no-change save writes zero rows; two changed fields write exactly two rows. GREEN: fix real-SQL defects.
- [x] 2.5 Mutation-verify 2.1-2.4 by name (check status before the lock, audit outside the tx, write status, restore the route pre-check).

## WU3: Photos under the guard (PR 3)

- [ ] 3.0 (moved from 2.2) RED `service.test.ts`: `transitionOrder` takes the lock with `canWrite: () => true`; done/cancelled → `invalid_transition` (400), nothing written; concurrent done-vs-cancel cannot both win; real-SQL e2e row for the concurrent case. GREEN `service.ts`. Note: the PATCH route's status branch passes `serviceDeps` (with its `getById`) to `transitionOrder` today; drop `getById` from `TransitionOrdenServicioDeps` here.
- [ ] 3.1 RED `photos.test.ts`: add and delete call `lockOrderForMutation` (replaces `lockOpenOrder`); `OrderClosedError` still importable from `photos.ts`; closed + grant adds at next position with a `foto` row `(null, photoId)`; delete writes `(photoId, null)`; 13th photo under correction throws `PhotoLimitError` and writes no audit row; closed without grant refused; failing put rolls back the audit row; object delete only after commit. GREEN `photos.ts`.
- [ ] 3.2 RED photo route tests (POST multipart `password`, DELETE JSON body `password`): técnico 403 (closed delete AND add); admin no/wrong password 409/403; throttled 429; correct 201/200; open-order behaviour unchanged; `route-guards.test.ts` lists `service-orders.correct` on photo POST and DELETE. GREEN `photos/route.ts`, `photos/[photoId]/route.ts`.
- [ ] 3.3 RED e2e rows in `order-corrections.e2e.test.ts`: admin adds to a `done` order with 2 photos (position 2, one `foto` row); admin deletes from `cancelled` (row removed, one `foto` row); 12 photos refuses the 13th with no audit row; throwing put leaves 0 new photo rows and 0 audit rows. GREEN: fix real-SQL defects.
- [ ] 3.4 Mutation-verify 3.1-3.3 by name (audit outside the tx, delete the object before commit, skip the cap under correction).
- [ ] 3.5 curl at `http://192.168.0.3:3000` as both roles: técnico photo POST/DELETE on a closed order 403.

## WU4: Correction interface (PR 4)

- [ ] 4.1 RED `edit-policy.test.ts`: shared pure predicate reports "correction required" for administrador on done/cancelled and "refused" for técnico. GREEN `edit-policy.ts`.
- [ ] 4.2 RED `CorrectionPasswordField` tests: `type="password"`, `autoComplete="current-password"`, label "Tu contraseña", cleared on close, required before submit. GREEN shared component.
- [ ] 4.3 RED `ServiceOrderForm`/`ServiceOrderFormTrigger` tests: correction mode sends `password`; 403 shows "Contraseña incorrecta" inline with typed values kept; 429 shows "Demasiados intentos. Probá de nuevo en 15 minutos."; success toast "Orden corregida" ABOVE `router.refresh()`, both below the `try/catch`; password required again on every save. GREEN both files.
- [ ] 4.4 RED `OrderPhotos` tests: closed + admin shows add/delete with the password field in each confirm; técnico sees no controls on a closed order; success toast reports APPLIED count. GREEN `OrderPhotos.tsx`.
- [ ] 4.5 RED detail page tests: admin on done/cancelled sees "Corregir" and no plain edit control; técnico sees neither; password dialog before editable form; "Corregir" carries `min-h-11 min-w-11`. GREEN `[id]/page.tsx`.
- [ ] 4.6 Mutation-verify 4.1-4.5 by name (keep the password in state after close, toast below refresh, show Corregir to técnico, drop `min-h-11`).
- [ ] 4.7 Playwright at `http://192.168.0.3:3000` (LAN IP, not localhost) as administrador and técnico at 390, 768 and desktop widths: read the console (RSC boundary, dialog is a portal); measure Corregir, confirm and cancel at >=44x44 on touch; dialog full-width at 390; wrong password inline with data kept; success toast. jsdom proves none of this.

## Spec archive notes

- [ ] 5.1 At archive, merge `service-order-corrections` as a NEW main spec; `service-orders` MODIFIES two requirements (Reception Photos; Order Editing Is Gated by Role and Current Status), replacing not duplicating; check for duplicates after the mechanical apply.
- [ ] 5.2 Follow-ups, not in scope: audit log viewer (first "who changed this?"); work lines plug in via `canEditWorkLines`; DB-backed throttle if the app runs more than one process.
