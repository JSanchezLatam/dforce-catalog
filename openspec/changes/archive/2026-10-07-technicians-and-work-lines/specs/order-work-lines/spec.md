# Spec: order-work-lines

New capability. Per-technician work lines (what was done, how long, on which day) and the "Mi parte lista" readiness mark.

## ADDED Requirements

### Requirement: Work Line Data

The system MUST persist `orden_linea_trabajo` rows with: the order, the `tecnico`, a required non-empty `description` (after trimming), `duracion_minutos` (integer, strictly greater than 0, enforced by the database as well as the service) and `fecha` (a calendar date, defaulting to today in the workshop's timezone). It MUST have an index on `(tecnico_id, fecha)` so hours per technician per period is one indexed `SUM(duracion_minutos)`. Lines MUST carry no price or cost of any kind. Foreign keys MUST be `ON DELETE RESTRICT`.

#### Scenario: Valid line persists
- GIVEN an in-progress order with an assigned technician
- WHEN a line with description "Cambio de pastillas", 90 minutes and today's date is saved
- THEN it MUST persist with those values and no price column MUST exist

#### Scenario: Non-positive or non-integer duration rejected
- GIVEN `duracion_minutos` of 0, -5, 1.5 or "abc"
- WHEN a line is submitted
- THEN the system MUST refuse it with a Spanish validation error and store nothing; a direct insert of 0 MUST be rejected by the database

#### Scenario: Blank description rejected
- GIVEN a line whose description is whitespace only
- WHEN it is submitted
- THEN the system MUST refuse it with a Spanish validation error

#### Scenario: Hours per technician per month is one indexed sum
- GIVEN lines for two technicians across two months
- WHEN hours for technician A in October are queried
- THEN `SUM(duracion_minutos)` filtered by `tecnico_id` and a `fecha` range MUST return only A's October minutes

### Requirement: Who Writes Work Lines and When

A work line MUST name a technician who is assigned to that order; naming an unassigned technician MUST be refused with a Spanish message. A `tecnico` MUST add, edit and delete only lines naming their own roster row, and only while the order is `in_progress`; a `tecnico` MUST NOT write a line on an order they are not assigned to (answered as the order not existing, 404). An `administrador` and a `jefe_taller` MUST add, edit and delete lines for any assigned technician while the order is `in_progress` or `ready_for_review`. No role MUST write a line on an `open` order. A técnico whose roster row has marked "Mi parte lista" MUST first un-mark before writing. Editing MUST NOT change a line's technician or order. Every write MUST run through `lockOrderForMutation` and evaluate the order's status as read from the locked row.

#### Scenario: Técnico logs own time
- GIVEN an `in_progress` order assigned to técnico T
- WHEN T adds a line naming T
- THEN the line MUST persist

#### Scenario: Técnico cannot log for another technician
- GIVEN an `in_progress` order assigned to T and U
- WHEN T adds a line naming U
- THEN the system MUST refuse with 403 and store nothing

#### Scenario: Line must name an assigned technician
- GIVEN an `in_progress` order not assigned to V
- WHEN an `administrador` adds a line naming V
- THEN the system MUST refuse it with a Spanish message and store nothing

#### Scenario: Técnico on an unassigned order
- GIVEN an order not assigned to T
- WHEN T sends any work-line request for it
- THEN the system MUST answer 404 and write nothing

#### Scenario: Open order takes no lines
- GIVEN an `open` order
- WHEN any role adds a line
- THEN the system MUST refuse it with a Spanish message and store nothing

#### Scenario: Jefe corrects a line during review
- GIVEN a `ready_for_review` order
- WHEN a `jefe_taller` edits a line's duration
- THEN the edit MUST persist and the order status MUST remain `ready_for_review`

#### Scenario: Técnico blocked after marking ready
- GIVEN técnico T who marked "Mi parte lista" on a `ready_for_review` order
- WHEN T adds a line
- THEN the system MUST refuse it with a Spanish message

#### Scenario: Line technician is immutable
- GIVEN an existing line naming T
- WHEN an edit tries to change its technician or order
- THEN the system MUST ignore or refuse the change and leave both unchanged

#### Scenario: Status read under the lock
- GIVEN an order that is `in_progress` when the request is routed
- WHEN it becomes `done` before the transaction takes the row lock
- THEN the write MUST be evaluated against `done` and refused

### Requirement: Mi Parte Lista

An assigned `tecnico` MUST be able to mark their own part ready on an `in_progress` order; this MUST set `parte_lista_at` on that technician's assignment. A técnico MUST be able to un-mark while the order is `in_progress` or `ready_for_review`, clearing `parte_lista_at`; un-marking a `ready_for_review` order MUST return it to `in_progress` in the same transaction. Marking and un-marking MUST apply only to the caller's own assignment (never another technician's), MUST run through `lockOrderForMutation`, and MUST recompute readiness inside that same locked transaction. Readiness is: the order has at least one assigned technician who is not deactivated, and every assigned non-deactivated technician has `parte_lista_at` set. When readiness becomes true the order MUST move to `ready_for_review` and record the transition timestamp. Marking MUST NOT require any work line. Marking an already-marked part, or marking on an order in any other status, MUST be refused with a Spanish message and write nothing.

#### Scenario: Last mark moves the order
- GIVEN an `in_progress` order assigned to T and U where U has marked
- WHEN T marks their part ready
- THEN the order status MUST become `ready_for_review` with its transition timestamp recorded

#### Scenario: First mark does not move it
- GIVEN an `in_progress` order assigned to T and U with no marks
- WHEN T marks
- THEN the order MUST remain `in_progress`

#### Scenario: Two simultaneous last marks
- GIVEN an `in_progress` order assigned to T and U, neither marked
- WHEN both mark at the same time
- THEN both marks MUST persist and the order MUST end `ready_for_review` exactly once

#### Scenario: Técnico un-marks
- GIVEN a `ready_for_review` order where T and U have marked
- WHEN T un-marks
- THEN T's `parte_lista_at` MUST be cleared and the order MUST return to `in_progress`

#### Scenario: Cannot mark another technician's part
- GIVEN an `in_progress` order assigned to T and U
- WHEN T sends a mark naming U's assignment
- THEN the system MUST refuse with 403 and change nothing

#### Scenario: Mark refused outside in_progress
- GIVEN an `open`, `done` or `cancelled` order assigned to T
- WHEN T marks
- THEN the system MUST refuse with a Spanish message and change nothing

#### Scenario: Deactivated technician does not block readiness
- GIVEN an `in_progress` order assigned to T and a deactivated U who never marked
- WHEN T marks
- THEN the order MUST become `ready_for_review`

#### Scenario: Mark needs no work line
- GIVEN an `in_progress` order assigned to T with no lines
- WHEN T marks
- THEN the mark MUST be accepted

#### Scenario: Admin and jefe close regardless
- GIVEN an order `in_progress` or `ready_for_review` with unmarked technicians
- WHEN an `administrador` or `jefe_taller` transitions it to `done`
- THEN it MUST be accepted regardless of marks

### Requirement: Work Line and Mark Interface

The order detail page MUST show a "Líneas de trabajo" card listing each line (technician, description, duration, date), per-technician totals, and an add control wherever the viewer may add. A técnico MUST see a "Mi parte lista" control (and its un-mark counterpart) for their own assignment only. The page MUST show each assigned technician's marked or pending state. The UI MUST work at tablet and phone widths, copy MUST be Spanish, every mutation MUST show a success toast above `router.refresh()` and below the `try/catch`, form errors MUST stay inline, and every action control MUST measure at least 44x44. No secure-context-only browser API MUST be used.

#### Scenario: Lines and totals shown
- GIVEN an order with lines from T (30 + 60 min) and U (45 min)
- WHEN staff opens its detail page
- THEN each line and the totals 90 min for T and 45 min for U MUST show

#### Scenario: Técnico sees only their own mark control
- GIVEN an `in_progress` order assigned to T and U
- WHEN T opens the page
- THEN a "Mi parte lista" control for T MUST show and none for U

#### Scenario: Mutation confirms
- GIVEN a successful line add or mark
- WHEN the response arrives
- THEN a Spanish success toast MUST show and the page MUST refresh

#### Scenario: Controls meet the hit-target floor
- GIVEN the card with its add, edit, delete and mark controls
- WHEN it renders
- THEN each MUST measure at least 44x44
