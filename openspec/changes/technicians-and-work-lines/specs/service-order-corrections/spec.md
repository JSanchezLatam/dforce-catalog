# Delta Spec: service-order-corrections

Delta against the `service-order-corrections` capability introduced by `closed-order-lock`, which MUST be archived before this change (this change ships after it). Work lines inherit the existing guard, password verification, throttle and audit table unchanged; only the work-line behavior below is new. `jefe_taller` is not widened into any correction rule.

## ADDED Requirements

### Requirement: Work Lines Can Be Written Under Correction, Audited

Under an authorized correction (administrator, correct password, not throttled) a work line MAY be added to, edited on, and deleted from a `done` or `cancelled` order. The Work Line Data and Who Writes Work Lines rules of `order-work-lines` still apply except the status gate: the line MUST name a technician assigned to the order, and the duration and description rules hold. Each add MUST write one audit row with field `linea_trabajo`, the new line id as the new value and no old value; each delete one row with field `linea_trabajo`, the line id as the old value and no new value; each edit one row per changed field named `linea_trabajo.<campo>` (`description`, `duracion_minutos`, `fecha`) carrying the line id prefix and old and new values. Audit rows MUST be written in the same transaction as the line change. Without an authorized correction, any work-line write on a closed order MUST be refused (técnico or jefe 403; administrador with no password 409; wrong password 403), writing no line and no audit row. A `jefe_taller` MUST be refused with 403 regardless of any password. "Mi parte lista" marks, un-marks and technician assignment MUST NOT be correctable: on a closed order they are refused for every role.

#### Scenario: Administrator adds a line to a closed order
- GIVEN a `done` order with an assigned technician T
- WHEN an administrator adds a 60-minute line naming T with their password
- THEN the line MUST persist and one `linea_trabajo` audit row MUST carry its id as the new value

#### Scenario: Administrator edits a line's duration
- GIVEN a `done` order with a 30-minute line
- WHEN an administrator changes it to 45 with their password
- THEN one `linea_trabajo.duracion_minutos` audit row MUST carry old 30 and new 45

#### Scenario: Administrator deletes a line
- GIVEN a `cancelled` order with a line
- WHEN an administrator deletes it with their password
- THEN the line MUST be removed and one `linea_trabajo` audit row MUST carry its id as the old value

#### Scenario: Line write refused without correction
- GIVEN a `done` order
- WHEN a técnico, a jefe, or an administrator with no or a wrong password writes a line
- THEN the system MUST refuse (técnico and jefe 403; no password 409; wrong password 403) and MUST NOT change any line or write an audit row

#### Scenario: Line must still name an assigned technician under correction
- GIVEN a `done` order not assigned to V
- WHEN an administrator adds a line naming V with their password
- THEN the system MUST refuse it and MUST NOT write a line or audit row

#### Scenario: Marks and assignments are not correctable
- GIVEN a `done` order
- WHEN an administrator with their correct password sends a mark, un-mark or new assignment
- THEN the system MUST refuse it and MUST NOT write anything

#### Scenario: Open-order line writes are not audited
- GIVEN an `in_progress` order
- WHEN a line is added, edited or deleted
- THEN no correction audit row MUST be written

#### Scenario: Audit and line commit or fail together
- GIVEN a correction whose audit insert fails
- WHEN the transaction ends
- THEN the line change MUST NOT be persisted
