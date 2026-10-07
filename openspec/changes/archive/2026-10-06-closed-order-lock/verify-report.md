# Verify Report: closed-order-lock

Verified at main @ 639bca7 (all four WUs merged). Verdict: **PASS WITH WARNINGS**. 0 CRITICAL, 3 WARNING, 2 SUGGESTION.

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test` | 175 files, 2597/2597 passed |
| `npm run lint` | 0 errors, 13 warnings (AGENTS.md says 14; update it) |
| `npm run test:e2e` (fresh `dforce_e2e`, dropped after) | 119/120 passed, 0 skipped, 1 FAIL (W1). `order-corrections.e2e.test.ts` and `order-lock.e2e.test.ts` fully green |
| Browser 4.7 / curl 3.5 | done by orchestrator, not re-run |

Tasks: all `[x]` except 2.2 (intentionally MOVED to 3.0, which is done) and 5.1/5.2 (archive notes). tasks.md matches code state.

## Warnings

- **W1 e2e red on main, not caused by this change.** `src/e2e/full-flow.e2e.test.ts:1846`, test "builds a selection, enqueues it ... (R5, R6, R11, R12)": expects a second user to get 404 on `/api/catalogs/:id/file`, gets 200. Cause: `catalogs.listAll` is `true` for `tecnico` in `src/modules/auth/policy.ts` MATRIX; this change's policy diff only adds `service-orders.correct`. Reproduced on two fresh DBs. Needs its own fix (test or policy; owner decides which is intended). Not confirmed on a pre-change checkout, only by diff inspection.
- **W2 Stale spec/design text** (deviations below). Amend at archive.
- **W3 Dialog confirm/cancel 44x44 has no test.** Only "Corregir" is pinned. The dialog actions rely on `Button` defaults; browser check 4.7 is the only evidence.

## Scenario coverage

Abbreviations: SVC = `src/modules/service-orders/service.test.ts`, LOCK = `order-lock.test.ts`, AUTH = `correction-auth.test.ts`, PH = `photos.test.ts` (all in `src/modules/service-orders/`); RT = `src/app/api/service-orders/[id]/route.test.ts`; PRT = `.../[id]/photos/route.test.ts`; DRT = `.../[id]/photos/[photoId]/route.test.ts`; E2E = `src/e2e/order-corrections.e2e.test.ts`; LE2E = `src/e2e/order-lock.e2e.test.ts`; PAGE = `src/app/(app)/service-orders/[id]/page.test.tsx`; FORM / TRIG / OP = `ServiceOrderForm.test.tsx` / `ServiceOrderFormTrigger.test.tsx` / `OrderPhotos.test.tsx`.

### service-order-corrections

| Scenario | Covering test |
|---|---|
| Closed order refused without correction | SVC "refuses a closed order read from the LOCKED row when no correction is granted, writing nothing"; E2E "a closed order without a grant is refused by the real lock"; LE2E "locks a real row: an open order passes, a closed one needs the grant, a missing grant refuses" (LOCK has no closed-without-grant unit test by name) |
| Status read under the lock | SVC "refuses a closed order read from the LOCKED row..."; LE2E "FOR UPDATE makes a second locker wait for the first transaction"; RT "reads the status from the record, not from a body claiming one" |
| Status transition on closed stays 400 | SVC "refuses a transition out of a locked %s order with OrderTransitionError and no write"; RT "rejects an invalid transition with 400 (R21)"; LE2E "a concurrent done and cancelled on one order cannot both win: the loser finds it closed" |
| Open order behaviour unchanged | RT "lets a tecnico patch an in_progress order, and the update receives the notes AS SENT"; SVC "writes no audit row for an edit of an OPEN order, even when a grant is present" |
| Admin with correct password corrects | E2E "an administrator's correction writes the field and exactly one audit row; status and completedAt are untouched"; RT "accepts a correct password on a closed order: 200, the field written, one audit row, password not stored" |
| Wrong password refused | RT "answers a wrong password 403 wrong_password, writing nothing"; E2E "a wrong password through the real handler is 403 and leaves the order and the audit table untouched" |
| Missing password refused (409) | RT "answers an administrator with no password on a closed order 409, without verifying anything"; E2E "an administrator with no password on a closed order is 409 and changes nothing" |
| Non-admin refused with valid password | RT "refuses a tecnico who sends a password on a closed order with 403, never verifying it"; AUTH "refuses a técnico as not_admin and never calls bcrypt"; E2E "a tecnico with their own correct password is 403 and changes nothing" |
| Password checked against session user | AUTH "verifies against the session user's own hash, never another administrator's" |
| Password asked on every save | TRIG "asks for the password again on every save"; FORM "shows 'Contraseña incorrecta' inline on a 403, keeping what was typed and asking for the password again"; server side stateless (RT no-password 409) |
| Fifth failure locks out | AUTH "answers the 5th failure as wrong, then throttles even the correct password without verifying"; RT "answers a throttled attempt 429 with Retry-After, writing nothing" |
| Lockout expires | AUTH "accepts again once the oldest failure leaves the 15-minute window" (and "stays throttled just inside the window") |
| Success resets counter | AUTH "clears the failures on success" |
| Throttle per user | AUTH "throttles per user" |
| One row per changed field | E2E "two changed fields write exactly two rows"; LE2E "recordCorrections writes exactly the changed fields, encoded as text"; LOCK "writes one row per CHANGED field only" |
| Unchanged fields write no row | LOCK "writes one row per CHANGED field only"; E2E first test (one field of the save changes, one row) |
| No change, no row | E2E "a save that changes nothing writes zero audit rows"; LOCK "writes nothing when no field changed" |
| Audit and change commit/fail together | E2E "a correctorId that is not a user fails the audit insert's FK and rolls the UPDATE back"; SVC "writes the fields and the audit rows in ONE transaction on a closed order with a grant" |
| Open-order edits not audited | E2E "a password sent for an OPEN order is ignored: the edit lands with no audit row"; SVC "writes no audit row for an edit of an OPEN order, even when a grant is present" |
| Status and completedAt survive | E2E first test; SVC "cannot be handed status or completedAt: the patch type excludes them" |
| Body status ignored | RT "never writes status or completedAt on a correction, whatever the body claims" |
| Categoria correction replans service_due | SVC "updateOrder replans the service_due at the NEW category's interval when categoria changes on a completed order" (via `asCorrection`). Audit of the categoria row specifically: LOCK/LE2E encode tests cover generic fields; no named test pairs categoria audit + replan end to end (minor) |
| Admin adds photo to closed order | PH "on a closed order WITH a grant adds at the next position and writes one foto audit row (null, photoId)"; E2E "an administrator adds to a done order with 2 photos: position 2 and exactly one foto audit row (null, photoId)"; PRT "verifies the password, then retries WITH the grant and answers 201" |
| Admin deletes photo from closed order | PH "on a closed order WITH a grant deletes the row, writes one foto audit row (photoId, null), then deletes the object"; E2E "an administrator deletes from a cancelled order: the row is gone and exactly one foto audit row (photoId, null) is written"; DRT "verifies the password, then retries WITH the grant and answers 200" |
| Photo write refused without correction | PRT "403 for a tecnico with password %s, and the password is never verified", "409 order_closed ... for an administrador with no password", "403 wrong_password ..."; DRT same three; E2E "a closed order without a grant refuses both add and delete and writes nothing" |
| Photo cap under correction | PH "refuses a 13th photo under correction with PhotoLimitError and writes no audit row"; E2E "12 photos refuse the 13th under correction, with no photo row and no audit row" |
| Administrator sees Corregir | PAGE "offers Corregir, and no plain edit control, to an administrador on a %s order" |
| Other roles read-only | PAGE "never offers Corregir to a %s on a %s order"; "offers neither add nor delete on a %s order to a role that cannot correct" |
| Password asked before editing | FORM "asks for the password in a dialog titled as a correction"; "keeps Guardar disabled until the password is typed"; PAGE "opens Corregir on a form that asks for the password". Deviation: see amendment 1 |
| Wrong password inline, data kept | FORM "shows 'Contraseña incorrecta' inline on a 403, keeping what was typed..."; OP "shows 'Contraseña incorrecta' inline, keeps the dialog and the files, and asks for the password again" |
| Success confirms | TRIG "announces 'Orden corregida' and refreshes after the PATCH lands" (and "still announces the correction when the refresh that follows it throws"); OP "POSTs every file with the password as multipart field `password`, then toasts above the refresh" |
| Hit-target floor | "Corregir": PAGE "applies the 44x44 floor to Corregir from its mount". Dialog confirm/cancel: **UNCOVERED** (W3) |

### service-orders (modified requirements)

| Scenario | Covering test |
|---|---|
| Valid JPEG added | PH "locks the order row, inserts the row, then puts the object, at the next position"; PRT "201 with {id, position} only (no r2Key), and records the caller as creator" |
| Non-JPEG refused | PH isJpeg "rejects a PNG" / "rejects text that merely claims to be image/jpeg"; PRT "400 for a PNG even when it declares image/jpeg" |
| Oversize refused | PH "caps a photo at 3 MB and an order at 12 photos"; PRT "413 from the real byte count when Content-Length lies" |
| Thirteenth photo refused | PH "refuses a 13th photo with PhotoLimitError and stores nothing"; PRT "409 photo_limit with the Spanish message" |
| Ordered by position | PAGE "lists this order's photos, in the order the query returns them (by position)"; real-SQL ordering not re-read here |
| Add gated by status | PH `it.each(["open","in_progress"])` accepts; `it.each(["done","cancelled"])` refuses with OrderClosedError |
| Delete administrador-only | DRT "403 for a tecnico and nothing is deleted"; "an administrador deletes the photo" |
| Delete refused on closed w/o correction | DRT "409 order_closed ... no password"; "403 wrong_password, and nothing is retried"; PH `it.each(["done","cancelled"])` "refuses a %s order and deletes neither the row nor the object" |
| Delete allowed on closed under correction | PH grant-delete test; E2E "an administrator deletes from a cancelled order..." |
| Serving is authenticated | DRT "refuses a request with no session"; "serves the bytes as a private, immutable, sandboxed image/jpeg" (pre-existing; the session-without-read branch is not separately tested) |
| Retention spares photos | pre-existing, untouched by this change, not re-verified |
| Admin sees edit control on open | PAGE `it.each` "offers the edit control to a %s on a %s order" |
| Tecnico sees none on open | PAGE `it.each` "offers NO edit control to a %s on a %s order" |
| Both roles on in_progress | same PAGE `it.each` |
| Only admin offered a way in on closed | PAGE "offers Corregir, and no plain edit control, to an administrador on a %s order"; "never offers Corregir to a %s on a %s order" |
| Route refuses patch the UI wouldn't offer | RT "refuses a tecnico patching an OPEN order with 403, without reaching the update" |
| Route refuses closed patch w/o verified correction | RT "refuses an administrador patching a DONE order with 409, without reaching the update"; "refuses a CANCELLED order with the same 409 as a done one"; "answers a wrong password 403 wrong_password, writing nothing" |
| Tecnico's closed patch refused 403 | RT "refuses a tecnico who sends a password on a closed order with 403, never verifying it"; "refuses a tecnico with no password on a closed order with 403, not the administrator's 409" |
| Verified admin correction saves | RT "accepts a correct password on a closed order: 200, ..."; E2E first test |
| Route reads status from record | RT "reads the status from the record, not from a body claiming one"; "never writes status or completedAt on a correction, whatever the body claims" |
| Permitted patch still saves | RT "lets a tecnico patch an in_progress order, and the update receives the notes AS SENT" |
| Edit control meets 44x44 | PAGE "applies the 44x44 floor to the edit control from its mount" |

**Uncovered:** only the dialog confirm/cancel half of "Correction controls meet the hit-target floor" (W3). Two pre-existing scenarios outside this change (serving without `service-orders.read`; retention) were not re-verified. Mutation-verification was recorded by the apply phase (tasks 1.7, 2.5, 3.4, 4.6), not re-run here.

## Spec/design text to amend at archive

1. **service-order-corrections / Correction Interface** says "Activating Corregir MUST ask for the administrator's password in a dialog before the form and photo controls become editable". Actual: the password field sits inside the correction form (type=password, "Tu contraseña", Guardar disabled until typed); for photos it sits in each add/delete confirmation. Reword to "the correction form and each photo add/delete confirmation MUST include a masked password field and MUST NOT submit without it". Scenario "Password is asked before editing" becomes "Password is required to save".
2. **design.md Technical Approach, Data Flow and the "Password verify placement" row** say the route authenticates the correction BEFORE the lock and diagram `authorizeCorrection` ahead of the service call. Actual (attempt-then-correct, `src/app/api/service-orders/[id]/route.ts` around lines 122-127): the route first tries the write without a grant; only on `OrderClosedError`, with a password present and `service-orders.correct` held, does it call `authorizeCorrection` and retry with the grant. Record the consequence: a password sent with an open-order edit is never verified, so a wrong one neither refuses nor counts toward the throttle (RT "never verifies a password sent with an open-order edit, so a wrong one neither refuses nor counts"). Photo routes do the same (PRT/DRT "verifies the password, then retries WITH the grant").
3. **design.md UI** says only the photo confirmations embed the password field; the form does too. Align.
4. **service-orders delta, Order Editing requirement** still carries "Today there is no entry point at all..." (the control exists now); trim when merging.
5. **tasks.md** 2.2 stays unchecked by design (moved to 3.0); note it in the archive summary.
6. **AGENTS.md** lint baseline: 14 warnings is now 13.
7. Archive mechanics (5.1): `service-order-corrections` is a NEW main spec; `service-orders` MODIFIES Reception Photos and Order Editing Is Gated by Role and Current Status (replace, then check for duplicates).

## Suggestions

- S1 Pin the dialog confirm/cancel hit target with a class assertion (as `OrderStatusControls.test.tsx` does) so W3 stops depending on a manual check.
- S2 tasks.md 5.2 follow-ups (route correction-error mapping onto `correction-http.ts`; DB-backed throttle if multi-process; audit viewer) stay open and correctly out of scope.

## CRITICAL

None.
