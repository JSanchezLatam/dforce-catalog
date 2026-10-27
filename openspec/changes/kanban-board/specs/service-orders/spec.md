# Delta for service-orders

## ADDED Requirements

### Requirement: Manual Urgent Flag

An order MAY carry a manual "Urgente" flag, stored as a nullable `urgente_at` timestamp and a nullable `urgente_by` (the user who set it); the latest set only, with no history. Both are null or both are set, enforced by the database. Only roles holding `service-orders.assign` (administrador, jefe_taller) MUST be able to set or clear it; a técnico or pantalla attempt MUST be refused with 403 and change nothing. Setting an already-urgent order or clearing a non-urgent one MUST be idempotent. The flag MUST NOT clear when the order reaches `done` or `cancelled`, and MUST NOT depend on elapsed time. On success the UI MUST toast "Orden marcada como urgente" or "Orden desmarcada como urgente" (above `router.refresh()`, below the `try/catch`); failures stay inline or in the board's error toast.

#### Scenario: Jefe sets and clears
- GIVEN a non-urgent order
- WHEN a jefe_taller marks it urgent and later clears it
- THEN `urgente_at` and `urgente_by` MUST be set to the time and the jefe, then both MUST be null **[e2e]**

#### Scenario: Técnico refused
- GIVEN a `tecnico` session
- WHEN it tries to set the flag
- THEN the response MUST be 403 and both columns MUST stay null **[e2e]**

#### Scenario: Idempotent set
- GIVEN an already-urgent order
- WHEN it is marked urgent again
- THEN the request MUST succeed and keep a single `urgente_by` **[e2e]**

#### Scenario: Survives leaving the board
- GIVEN an urgent order
- WHEN it is moved to `done`, or cancelled
- THEN `urgente_at` MUST remain set **[e2e]**

#### Scenario: Database ties the pair
- GIVEN a direct write with `urgente_at` set and `urgente_by` null
- WHEN it executes
- THEN the database MUST reject it **[e2e]**
