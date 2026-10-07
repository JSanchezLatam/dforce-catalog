# Spec: service-order-corrections

An `administrador` may correct a `done` or `cancelled` order after re-typing their own password; every change is audited. Status and `completedAt` are never touched.

## Requirements

### Requirement: One Server-Side Guard for Every Order Mutation

Every code path that writes an order or its photos MUST first lock the order row (`SELECT ... FOR UPDATE`) inside the writing transaction and MUST evaluate the order's status as read from that locked row. The check MUST NOT live only in the route. When the locked status is `open` or `in_progress`, the existing role and status rules of the `service-orders` capability apply unchanged. When it is `done` or `cancelled`, the write MUST be refused unless an authorized administrator correction is present (see Closed Orders Accept Corrections Only From a Password-Verified Administrator). A refusal MUST answer with a Spanish message and an accurate status code (never 500) and MUST write nothing. The guard MUST be the only place the closed-order decision is made, so a future writer (for example work lines) inherits it.

#### Scenario: Closed order refused without correction
- GIVEN an order whose stored status is `done`
- WHEN any mutation reaches the service without an authorized correction
- THEN the system MUST refuse it and MUST NOT write any column, photo or audit row

#### Scenario: Status is read under the lock, not before it
- GIVEN an order that is `in_progress` when a request is routed
- WHEN it becomes `done` before the request's transaction takes the row lock
- THEN the guard MUST evaluate `done` and refuse

#### Scenario: Status transition on a closed order stays a 400
- GIVEN an order whose locked status is `done` or `cancelled`
- WHEN a status transition reaches `transitionOrder`, with or without a password
- THEN the transition MUST run under the same row lock and `assertTransition` MUST refuse it as `invalid_transition` (400), writing nothing; the guard does not turn it into a correction

#### Scenario: Open order behaviour is unchanged
- GIVEN an `in_progress` order and a `tecnico` patching `hallazgos`
- WHEN the guard runs
- THEN the patch MUST succeed and MUST NOT write an audit row

### Requirement: Closed Orders Accept Corrections Only From a Password-Verified Administrator

A correction of a `done` or `cancelled` order MUST be accepted only when all hold: the session user's role is `administrador`; the request carries a `password`; and that password verifies, server-side and in the same request that saves, against the SESSION user's own stored hash. The password MUST be required on every correcting save, with no grace window or remembered verification. A non-`administrador` MUST be refused regardless of the password, and the password MUST NOT be verified for them. No reason or "motivo" field is required. A refusal for a missing or wrong password MUST use a Spanish message, MUST NOT reveal anything beyond "incorrect password", and MUST leave the order, its photos and the audit table unchanged. The password MUST NOT be logged, echoed, stored or written to the audit table.

#### Scenario: Administrator with correct password corrects a closed order
- GIVEN a `done` order and an `administrador` session
- WHEN the administrator saves a changed `hallazgos` with their correct password
- THEN the new value MUST persist and one audit row MUST exist for it

#### Scenario: Wrong password refused
- GIVEN a `done` order and an `administrador` session
- WHEN a save arrives with an incorrect password
- THEN the system MUST refuse with 403 `{ error: "wrong_password" }` and a Spanish message, and MUST NOT change the order or write an audit row (the failed attempt itself is counted by the throttle, never audited)

#### Scenario: Missing password refused
- GIVEN a `cancelled` order and an `administrador` session
- WHEN a save arrives with no password
- THEN the system MUST refuse with 409 (the closed-order refusal, unchanged) and MUST NOT change the order or write an audit row

#### Scenario: Non-administrator refused even with a valid password
- GIVEN a `done` order and a `tecnico` session whose own password is supplied correctly
- WHEN the save arrives
- THEN the system MUST refuse with 403 and MUST NOT change the order or write an audit row

#### Scenario: Password is checked against the session user, not another account
- GIVEN an `administrador` session and another administrator's correct password
- WHEN the save arrives with that password
- THEN the system MUST refuse it as incorrect

#### Scenario: Password asked on every correcting save
- GIVEN an administrator who corrected a closed order moments ago
- WHEN they save a second correction without a password
- THEN the system MUST refuse it

### Requirement: Failed Password Attempts Are Throttled

The system MUST count failed correction-password attempts per user, in memory, and MUST refuse further correction attempts from that user for 15 minutes after the 5th failure inside a 15-minute window. A refusal due to throttling MUST use a Spanish message, MUST answer 429, MUST NOT verify the password, and MUST write nothing. A successful verification MUST reset that user's counter. Counters are per user, so one user's failures MUST NOT throttle another. Counters are not durable: a process restart clears them (accepted ceiling of the single-process deployment).

#### Scenario: Fifth failure locks the user out
- GIVEN an administrator with 4 failed attempts in the last 15 minutes
- WHEN a 5th wrong password arrives, and then a correct password arrives immediately after
- THEN the 5th MUST be refused as incorrect (403), and the correct one MUST be refused with 429 and a `Retry-After` header and write nothing

#### Scenario: Lockout expires
- GIVEN an administrator locked out 15 minutes ago
- WHEN they save with the correct password
- THEN the correction MUST be accepted

#### Scenario: Success resets the counter
- GIVEN an administrator with 3 recent failures
- WHEN they save with the correct password and later fail twice
- THEN they MUST NOT be throttled

#### Scenario: Throttle is per user
- GIVEN administrator A is locked out
- WHEN administrator B saves a correction with their correct password
- THEN B's correction MUST be accepted

### Requirement: Every Correction Is Audited in the Same Transaction

The system MUST persist an `orden_servicio_correccion` table with one row per changed field per correction: the order id, the correcting administrator's user id, a timestamp, the field name, the old value and the new value. Audit rows MUST be written in the same database transaction as the change they describe, so a change without its row, or a row without its change, MUST be impossible. Only fields whose value actually changed MUST produce a row; a save that changes nothing MUST write no audit row. Audit rows MUST be written only for corrections to closed orders, never for edits to `open` or `in_progress` orders. The audit table MUST be append-only from the application: no code path updates or deletes its rows.

#### Scenario: One row per changed field
- GIVEN a `done` order
- WHEN an administrator corrects `hallazgos` and `categoria` with their password
- THEN exactly two audit rows MUST exist, each carrying the order id, the administrator's id, a timestamp, the field name, and the old and new values

#### Scenario: Unchanged fields write no row
- GIVEN a `done` order
- WHEN an administrator saves with their password and changes only `observaciones`
- THEN exactly one audit row, for `observaciones`, MUST exist

#### Scenario: No change, no row
- GIVEN a `done` order
- WHEN an administrator saves identical values with their password
- THEN no audit row MUST be written

#### Scenario: Audit and change commit or fail together
- GIVEN a correction whose audit insert fails
- WHEN the transaction ends
- THEN the order change MUST NOT be persisted

#### Scenario: Open-order edits are not audited
- GIVEN an `open` order edited by an administrator
- WHEN the save succeeds
- THEN no `orden_servicio_correccion` row MUST be written

### Requirement: Correction Never Changes Status or Completion Time

A correction MUST NOT change the order's `status` or `completedAt`, MUST NOT reopen the order, and MUST NOT accept a status in the request. A closed order MUST remain `done` or `cancelled` after any correction. When a correction changes `categoria`, the system MUST replan `service_due` exactly as for an open-order `categoria` change, and the `categoria` change MUST be audited like any other field.

#### Scenario: Status and completedAt survive a correction
- GIVEN a `done` order with a `completedAt`
- WHEN an administrator corrects `hallazgos` with their password
- THEN `status` MUST still be `done` and `completedAt` MUST be unchanged

#### Scenario: Body status ignored
- GIVEN a `done` order
- WHEN a correction arrives whose body also claims `in_progress`
- THEN the stored status MUST remain `done`

#### Scenario: Categoria correction replans service_due
- GIVEN a `done` order whose categoria change alters the due date
- WHEN an administrator corrects `categoria` with their password
- THEN `service_due` MUST be replanned and the `categoria` change MUST be audited

### Requirement: Photos Can Be Added and Deleted Under Correction, Audited

Under an authorized correction (administrator, correct password, not throttled) a photo MAY be added to, and deleted from, a `done` or `cancelled` order. The add and delete rules of the Reception Photos requirement still apply (12-photo cap, JPEG signature, 3 MB, deletion administrator-only). Each add and each delete MUST write one audit row with field `foto`: an add stores the new photo id as the new value and no old value; a delete stores the photo id as the old value and no new value. The audit row MUST be written in the same transaction as the photo row change, and a deleted photo's stored object MUST be removed only after that transaction commits. Without an authorized correction, photo add and delete on a closed order MUST be refused.

#### Scenario: Administrator adds a photo to a closed order
- GIVEN a `done` order with 2 photos
- WHEN an administrator uploads a valid JPEG with their password
- THEN the photo MUST be stored at the next position and one `foto` audit row MUST carry its id as the new value

#### Scenario: Administrator deletes a photo from a closed order
- GIVEN a `cancelled` order with a photo
- WHEN an administrator deletes it with their password
- THEN the photo and its object MUST be removed and one `foto` audit row MUST carry its id as the old value

#### Scenario: Photo write refused without correction
- GIVEN a `done` order
- WHEN a `tecnico` uploads a photo, or an administrator deletes one with no or a wrong password
- THEN the system MUST refuse (técnico 403; administrator with no password 409; wrong password 403), MUST NOT change the photos and MUST NOT write an audit row

#### Scenario: Photo cap still applies under correction
- GIVEN a `done` order with 12 photos
- WHEN an administrator uploads another with their password
- THEN the system MUST refuse it and MUST NOT write an audit row

### Requirement: Correction Interface

On a `done` or `cancelled` order's detail page, an `administrador` MUST be offered a "Corregir" control; every other role MUST see the order read-only with no edit or photo-change control. The correction form and each photo add/delete confirmation MUST include a masked password field and MUST NOT submit without it; the password MUST be verified by, and sent with, the saving request (the field alone proves nothing). Wrong, throttled and non-administrator refusals MUST show their Spanish message inline where the operator is looking, with the entered data preserved. A successful correction MUST show a success toast beside the existing refresh. The UI MUST work at tablet and phone widths, copy MUST be Spanish, and "Corregir" and the dialog's actions MUST meet the 44x44 hit-target floor.

#### Scenario: Administrator sees Corregir on a closed order
- GIVEN a `done` or `cancelled` order
- WHEN an `administrador` opens its detail page
- THEN the page MUST offer "Corregir"

#### Scenario: Other roles see read-only
- GIVEN a `done` order
- WHEN a `tecnico` opens its detail page
- THEN the page MUST NOT offer "Corregir", any edit control, or photo add/delete

#### Scenario: Password is required to save
- GIVEN an administrator on a closed order with changes to save
- WHEN they attempt to save without a password
- THEN the form MUST NOT submit and MUST ask for the password again

#### Scenario: Wrong password shown inline, data kept
- GIVEN an administrator who typed changes and a wrong password
- WHEN the server refuses
- THEN a Spanish message MUST appear inline and the typed changes MUST remain

#### Scenario: Success confirms
- GIVEN a correct password and a changed field
- WHEN the server accepts
- THEN a success toast MUST show and the page MUST refresh with the new value

#### Scenario: Correction controls meet the hit-target floor
- GIVEN the page offering "Corregir"
- WHEN it renders
- THEN "Corregir" and the dialog's confirm and cancel actions MUST measure at least 44x44
