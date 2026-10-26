# Delta Spec: metrics-dashboard

The backlog snapshot learns the new states. Tag **[e2e]** = SQL value (counts must match real rows).

## MODIFIED Requirements

### Requirement: Open Backlog Snapshot

The dashboard MUST show the current count of orders in each non-terminal status, one counter per status: `booked` ("Agendada"), `open` ("Recibida"), `diagnosing` ("En diagnóstico"), `in_progress` ("En progreso"), `on_hold` ("En espera") and `ready_for_review` ("Lista para revisión"). It MUST be a live snapshot independent of the selected month and MUST NOT include `done` or cancelled orders. Every non-terminal order MUST be counted by exactly one counter, so the counters sum to the number of non-terminal orders.
(Previously: three counters — `open`, `in_progress`, `ready_for_review`.)

#### Scenario: Backlog counts **[e2e]**
- GIVEN 1 booked, 2 open, 3 diagnosing, 1 in_progress, 2 on_hold, 4 ready_for_review, 9 done and 2 cancelled orders
- WHEN the dashboard renders, for any selected month
- THEN it shows 1, 2, 3, 1, 2 and 4 under their labels

#### Scenario: Counters cover every non-terminal order **[e2e]**
- GIVEN any mix of orders
- WHEN the counters render
- THEN their sum MUST equal the count of orders whose status is neither `done` nor `cancelled`

#### Scenario: Terminal orders excluded
- GIVEN only `done` and `cancelled` orders
- WHEN the dashboard renders
- THEN every counter MUST show 0

#### Scenario: Zero is shown
- GIVEN no order is `on_hold`
- WHEN the dashboard renders
- THEN the "En espera" counter MUST be present and show 0
