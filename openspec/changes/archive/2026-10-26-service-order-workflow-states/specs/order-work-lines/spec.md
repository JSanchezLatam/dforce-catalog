# Delta Spec: order-work-lines

Work lines and "Mi parte lista" follow the new states: técnicos work in `diagnosing` and `in_progress`; `on_hold` freezes line writes and marks. Tags: **[e2e]** = SQL value (locking, status read from the locked row, auto-transitions, history), **[unit]** = pure. Both MODIFIED blocks are the full requirement, restated.

## MODIFIED Requirements

### Requirement: Who Writes Work Lines and When

A work line MUST name a technician who is assigned to that order; naming an unassigned technician MUST be refused with a Spanish message. A `tecnico` MUST add, edit and delete only lines naming their own roster row, and only while the order is `diagnosing` or `in_progress`; a `tecnico` MUST NOT write a line on an order they are not assigned to (answered as the order not existing, 404). An `administrador` and a `jefe_taller` MUST add, edit and delete lines for any assigned technician while the order is `diagnosing`, `in_progress` or `ready_for_review`. No role MUST write a line on a `booked`, `open` or `on_hold` order (nor, outside an authorized correction, on a closed one). A técnico whose roster row has marked "Mi parte lista" MUST first un-mark before writing. Editing MUST NOT change a line's technician or order. Every write MUST run through `lockOrderForMutation` and evaluate the order's status as read from the locked row.
(Previously: técnico writes only while `in_progress`; admin/jefe while `in_progress` or `ready_for_review`; only `open` was named as refused.)

#### Scenario: Técnico logs own time
- GIVEN an `in_progress` order assigned to técnico T
- WHEN T adds a line naming T
- THEN the line MUST persist

#### Scenario: Técnico logs time while diagnosing
- GIVEN a `diagnosing` order assigned to técnico T
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

#### Scenario: Booked, open and on-hold orders take no lines
- GIVEN a `booked`, an `open` and an `on_hold` order
- WHEN any role adds a line to each
- THEN the system MUST refuse each with a Spanish message and store nothing

#### Scenario: Hold freezes edits and deletes too
- GIVEN an `on_hold` order with an existing line
- WHEN an administrador or the técnico who owns the line edits or deletes it
- THEN the system MUST refuse it and the line MUST be unchanged

#### Scenario: Lines are writable again after resuming
- GIVEN an `on_hold` order resumed to `in_progress`
- WHEN its technician adds a line
- THEN the line MUST persist

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

#### Scenario: Status read under the lock **[e2e]**
- GIVEN an order that is `in_progress` when the request is routed
- WHEN it becomes `on_hold` or `done` before the transaction takes the row lock
- THEN the write MUST be evaluated against the new status and refused

### Requirement: Mi Parte Lista

An assigned `tecnico` MUST be able to mark their own part ready on an `in_progress` order; this MUST set `parte_lista_at` on that technician's assignment. A técnico MUST be able to un-mark while the order is `in_progress` or `ready_for_review`, clearing `parte_lista_at`; un-marking a `ready_for_review` order MUST return it to `in_progress` in the same transaction. Marking and un-marking MUST apply only to the caller's own assignment (never another technician's), MUST run through `lockOrderForMutation`, and MUST recompute readiness inside that same locked transaction. Readiness is: the order has at least one assigned technician who is not deactivated, and every assigned non-deactivated technician has `parte_lista_at` set. When readiness becomes true the order MUST move to `ready_for_review`, record the transition timestamp and write its history row (see `service-order-status-history`); readiness is derived from marks alone and no one MUST be able to request it manually. Marking MUST NOT require any work line. Marking an already-marked part, or marking or un-marking on an order in any status other than those named above (`booked`, `open`, `diagnosing`, `on_hold`, `done`, `cancelled`), MUST be refused with a Spanish message and write nothing.
(Previously: refusal named `open`, `done` and `cancelled`; readiness wrote no history.)

#### Scenario: Last mark moves the order **[e2e]**
- GIVEN an `in_progress` order assigned to T and U where U has marked
- WHEN T marks their part ready
- THEN the order status MUST become `ready_for_review` with its transition timestamp recorded and one history row `in_progress → ready_for_review`

#### Scenario: First mark does not move it
- GIVEN an `in_progress` order assigned to T and U with no marks
- WHEN T marks
- THEN the order MUST remain `in_progress`

#### Scenario: Two simultaneous last marks **[e2e]**
- GIVEN an `in_progress` order assigned to T and U, neither marked
- WHEN both mark at the same time
- THEN both marks MUST persist and the order MUST end `ready_for_review` exactly once, with exactly one history row for it

#### Scenario: Técnico un-marks **[e2e]**
- GIVEN a `ready_for_review` order where T and U have marked
- WHEN T un-marks
- THEN T's `parte_lista_at` MUST be cleared, the order MUST return to `in_progress` and one history row `ready_for_review → in_progress` MUST exist

#### Scenario: Cannot mark another technician's part
- GIVEN an `in_progress` order assigned to T and U
- WHEN T sends a mark naming U's assignment
- THEN the system MUST refuse with 403 and change nothing

#### Scenario: Mark refused outside in_progress
- GIVEN a `booked`, `open`, `diagnosing`, `on_hold`, `done` or `cancelled` order assigned to T
- WHEN T marks
- THEN the system MUST refuse with a Spanish message and change nothing

#### Scenario: Un-mark refused while on hold
- GIVEN an `on_hold` order whose technician T had marked before the hold
- WHEN T un-marks
- THEN the system MUST refuse with a Spanish message and T's mark MUST be unchanged

#### Scenario: Marks survive a hold **[e2e]**
- GIVEN an `in_progress` order where T has marked and U has not
- WHEN a jefe puts it on hold and resumes it
- THEN T's `parte_lista_at` MUST still be set and U's still null

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
