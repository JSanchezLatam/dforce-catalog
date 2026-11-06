# Spec: order-work-lines

Per-technician work lines (what was done, how long, on which day) and the "Mi parte lista" readiness mark.

## Requirements

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

A work line MUST name a technician who is assigned to that order; naming an unassigned technician MUST be refused with a Spanish message. A `tecnico` MUST add, edit and delete only lines naming their own roster row, and only while the order is `diagnosing` or `in_progress`; a `tecnico` MUST NOT write a line on an order they are not assigned to (answered as the order not existing, 404). An `administrador` and a `jefe_taller` MUST add, edit and delete lines for any assigned technician while the order is `diagnosing`, `in_progress` or `ready_for_review`. No role MUST write a line on a `booked`, `open` or `on_hold` order (nor, outside an authorized correction, on a closed one). A técnico whose roster row has marked "Mi parte lista" MUST first un-mark before writing. Editing MUST NOT change a line's technician or order. Every write MUST run through `lockOrderForMutation` and evaluate the order's status as read from the locked row.

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

### Requirement: Work Line and Mark Interface

The order detail page MUST show a "Líneas de trabajo" card listing each line (technician, description, duration, date), per-technician totals, and an add control wherever the viewer may add. A técnico MUST see a "Mi parte lista" control (and its un-mark counterpart) for their own assignment only. The page MUST show each assigned technician's marked or pending state. The UI MUST work at tablet and phone widths, copy MUST be Spanish, every mutation MUST show a success toast above `router.refresh()` and below the `try/catch`, form errors MUST stay inline, and every action control MUST measure at least 44x44. No secure-context-only browser API MUST be used.

When the card withholds a control because of the order's status or the viewer's own mark, it MUST say why with a hint: `muted-foreground` text, `text-sm`, 16px info icon, no box and no color. The hint is chosen by the status and the viewer's role (`administrador`/`jefe_taller` = "jefe", versus `tecnico`):

| Situation | Viewer | Hint | Button |
|---|---|---|---|
| `open`, no assigned technician | jefe | "Asigná un técnico para poder cargar líneas." | "Asignar técnico" (focuses `#assign-tecnico`), or link "Ir a Técnicos" to `/technicians` when no `#assign-tecnico` renders |
| `booked` | jefe | "Recibí la orden para cargar líneas." | none |
| `booked` | técnico | "El jefe de taller tiene que recibir la orden para cargar líneas." | none |
| `on_hold` | jefe | "La orden está en espera; reanudala para cargar líneas." | none |
| `on_hold` | técnico | "La orden está en espera; el jefe de taller tiene que reanudarla." | none |
| `diagnosing` | técnico (own part unmarked) | "Vas a poder marcar tu parte cuando el jefe de taller pase la orden a En progreso." | none (next to "Agregar línea") |
| `in_progress` or `ready_for_review`, own part marked | técnico | "Desmarcá tu parte lista antes de cambiar líneas de trabajo." | none (next to "Desmarcar mi parte") |

The previously unreachable "Asigná un técnico para poder cargar líneas." condition at `OrderWorkCard.tsx:196` (it required `mode !== "refused"` while `open` is always refused) MUST be replaced by the table above. The hint row sits above the empty-state line "Todavía no hay líneas de trabajo." when there are no lines, which stays. No hint from the table MUST render when the viewer can write and has nothing withheld (an administrador/jefe on `diagnosing`, `in_progress` or `ready_for_review`; a técnico with an unmarked part on `in_progress`), nor on a closed order. The `diagnosing` técnico row is informational: it renders while writing is allowed, because only "Mi parte lista" is withheld. "Mi parte lista" stays available only on `in_progress`, unchanged.
(Previously: no hint explained a missing control, and with `workLineMode` `refused` the card showed only "Todavía no hay líneas de trabajo.".)

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

#### Scenario: Recibida without técnico, jefe **[unit]**
- GIVEN an `open` order with no assignee, viewed by an administrador, with `#assign-tecnico` on the page
- WHEN the card renders
- THEN "Asigná un técnico para poder cargar líneas." MUST show above "Todavía no hay líneas de trabajo." with an "Asignar técnico" button that focuses `#assign-tecnico`

#### Scenario: Recibida without técnico and nobody left to assign **[unit]**
- GIVEN the same order with no `#assign-tecnico` rendered
- WHEN the card renders
- THEN the button MUST be a link "Ir a Técnicos" to `/technicians`

#### Scenario: Agendada, jefe **[unit]**
- GIVEN a `booked` order with an assignee, viewed by a jefe_taller
- WHEN the card renders
- THEN "Recibí la orden para cargar líneas." MUST show and no button MUST accompany it

#### Scenario: Agendada, técnico **[unit]**
- GIVEN the same order viewed by the assigned técnico
- WHEN the card renders
- THEN "El jefe de taller tiene que recibir la orden para cargar líneas." MUST show and "Recibí la orden para cargar líneas." MUST NOT

#### Scenario: En espera, jefe **[unit]**
- GIVEN an `on_hold` order viewed by an administrador
- WHEN the card renders
- THEN "La orden está en espera; reanudala para cargar líneas." MUST show

#### Scenario: En espera, técnico **[unit]**
- GIVEN the same order viewed by an assigned técnico
- WHEN the card renders
- THEN "La orden está en espera; el jefe de taller tiene que reanudarla." MUST show

#### Scenario: En diagnóstico, técnico **[unit]**
- GIVEN a `diagnosing` order assigned to técnico T (part unmarked)
- WHEN T opens it
- THEN "Agregar línea" MUST show, "Mi parte lista" MUST NOT, and "Vas a poder marcar tu parte cuando el jefe de taller pase la orden a En progreso." MUST show

#### Scenario: En diagnóstico hint is técnico-only **[unit]**
- GIVEN the same order viewed by a jefe_taller
- WHEN the card renders
- THEN that hint MUST NOT show

#### Scenario: Técnico after Mi parte lista **[unit]**
- GIVEN an `in_progress` order where técnico T has marked their part
- WHEN T opens it
- THEN "Desmarcar mi parte" MUST show, "Agregar línea", "Editar" and "Eliminar" MUST NOT, and "Desmarcá tu parte lista antes de cambiar líneas de trabajo." MUST show

#### Scenario: Lista para revisión, técnico **[unit]**
- GIVEN a `ready_for_review` order where técnico T has marked their part
- WHEN T opens it
- THEN "Desmarcá tu parte lista antes de cambiar líneas de trabajo." MUST show, and "La orden está lista para revisión; solo el jefe de taller puede cambiar líneas." MUST NOT exist anywhere (it is false while "Desmarcar mi parte" is offered)

#### Scenario: No hint when the viewer can write **[unit]**
- GIVEN an `in_progress` order and a técnico with an unmarked part, and a jefe on `ready_for_review`
- WHEN each card renders
- THEN none of the hints in the table MUST show

#### Scenario: Copy is exact **[unit]**
- GIVEN every row of the table rendered at least once
- WHEN the texts are read
- THEN each MUST equal the string in the table character for character, accents and voseo included

#### Scenario: Hint layout beside controls **[browser]**
- GIVEN the "Desmarcar mi parte" and "Agregar línea" rows with a hint at 390px and 768px, light and dark
- WHEN rendered
- THEN the hint MUST wrap beside or under the button without overflowing, and the button MUST stay at least 44x44

