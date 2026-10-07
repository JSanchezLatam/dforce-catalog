# Metrics Dashboard Specification

## Purpose

Aggregated metrics and technician productivity dashboard. Role-scoped to administrators and jefe_taller on `/metrics` for team-wide metrics; technician-only `/mis-numeros` for viewing own numbers. New `metrics.read` and `metrics.self` RBAC actions.

## Requirements

### Requirement: Metrics Read Permission

The system MUST define a `metrics.read` action granted to `administrador` and `jefe_taller` only. `tecnico` MUST NOT hold it. Existing grants MUST be unchanged. Anyone without it requesting `/metrics` MUST get the shared no-permission screen.

#### Scenario: Roles that may read
- GIVEN users with roles `administrador`, `jefe_taller`, `tecnico`
- WHEN each requests `/metrics`
- THEN the first two see the dashboard
- AND the `tecnico` sees the shared no-permission screen

### Requirement: Technician Productivity

For a selected month (default: current month in America/Panama), the dashboard MUST show per technician BOTH orders closed (`status = done`, bucketed by `completed_at`) AND hours logged (sum of work-line minutes by technician, bucketed by line `fecha`, shown in hours). A technician is listed when they have closed orders or hours in that month; inactive technicians are shown only when they have non-zero numbers. The two figures MUST always appear together. Cancelled orders MUST NOT count as closed.

#### Scenario: Both figures shown
- GIVEN technician A closed 3 orders and logged 270 minutes in the selected month
- WHEN an administrador opens `/metrics`
- THEN A's row shows 3 closed orders and 4.5 hours

#### Scenario: Cancelled order
- GIVEN an order cancelled in the selected month
- WHEN productivity is computed
- THEN it counts for no technician

### Requirement: Month Selector

The per-technician table MUST let the user choose among the last 12 workshop months (current included) through a native `<select>` meeting the 44x44 touch floor. The chosen month MUST come from a `?mes=YYYY-MM` query parameter that is validated against those 12 keys; an absent or invalid value MUST fall back to the current Panama month and MUST NOT be trusted beyond that. The trend window (received vs closed) is independent and fixed at the last 6 months.

#### Scenario: Valid month
- GIVEN today is in October 2026
- WHEN an administrador opens `/metrics?mes=2026-08`
- THEN the table shows August 2026 figures

#### Scenario: Invalid month
- GIVEN today is in October 2026
- WHEN `/metrics?mes=2019-01` or `/metrics?mes=garbage` is requested
- THEN the table shows October 2026 and no error occurs

### Requirement: Shared-Order Crediting

A closed order MUST count once for EVERY technician assigned to it. The per-technician table MUST state: "Una orden con varios técnicos cuenta para cada uno". The per-technician sum MAY exceed the total of closed orders.

#### Scenario: Two technicians
- GIVEN one order closed in the month, assigned to A and B
- WHEN the table renders
- THEN A shows 1 and B shows 1
- AND the total closed orders metric shows 1
- AND the explanatory note is visible

### Requirement: Month Bucketing in America/Panama

Every month bucket MUST be determined in America/Panama, never UTC. `fecha` is already a local date and MUST be bucketed as-is. The current month MUST come from the workshop-local date.

#### Scenario: Month boundary
- GIVEN an order completed at 2026-10-01 00:00 Panama (05:00 UTC) and another at 2026-09-30 23:59 Panama (04:59 UTC Oct 1)
- WHEN monthly closed orders are computed
- THEN the first counts in October and the second in September

### Requirement: Orders Received and Closed per Month

The dashboard MUST show orders received per month (`created_at`, includes later-cancelled orders) and orders closed per month (`done`, `completed_at`), over a trend window whose default is the last 6 months including the current one. Months without orders MUST appear with 0.

#### Scenario: Six-month window
- GIVEN today is in October 2026
- WHEN the trend renders with defaults
- THEN it covers May through October 2026, one entry per month, in order

#### Scenario: Zero month
- GIVEN no orders were received in July
- WHEN the trend renders
- THEN July is present with 0

### Requirement: Open Backlog Snapshot

The dashboard MUST show the current count of orders in `open`, `in_progress` and `ready_for_review`. It MUST be a live snapshot independent of the selected month and MUST NOT include `done` or cancelled orders.

#### Scenario: Backlog counts
- GIVEN 2 open, 1 in_progress, 4 ready_for_review, 9 done orders
- WHEN the dashboard renders, for any selected month
- THEN it shows 2, 1 and 4

### Requirement: Mis Números

A `tecnico` MUST have `/mis-numeros` showing closed orders (in a table) and hours-per-month (as a bar chart) for their own roster row only. The technician id MUST be resolved server-side from the session user, never from the URL, query, or body. Any supplied technician parameter MUST be ignored or refused, and MUST NOT change the data shown. `/mis-numeros` is for `tecnico` only (action `metrics.self`); `administrador` and `jefe_taller` use `/metrics` and MUST get the shared no-permission screen on `/mis-numeros`.

#### Scenario: Own numbers only
- GIVEN técnico A and técnico B both have closed orders
- WHEN A opens `/mis-numeros`
- THEN only A's figures appear, none of B's

#### Scenario: Forged parameter
- GIVEN técnico A is signed in
- WHEN A requests `/mis-numeros?tecnicoId=<B's id>`
- THEN B's data is not returned and A's own (or a refusal) is shown

#### Scenario: Mis números denied to admin and jefe
- GIVEN an `administrador` or `jefe_taller` is signed in
- WHEN they request `/mis-numeros`
- THEN the shared no-permission screen is shown

#### Scenario: Metrics page denied
- GIVEN técnico A is signed in
- WHEN A requests `/metrics`
- THEN the shared no-permission screen is shown

### Requirement: Empty States

With no data in the selected month, the dashboard MUST show Spanish empty copy ("Todavía no hay órdenes cerradas en {mes}. Una orden cuenta cuando pasa a Completada.") instead of blank charts or an error. A `tecnico` whose user has no roster row MUST see an empty state ("Todavía no estás en la lista de técnicos") on `/mis-numeros`, not an error.

#### Scenario: Técnico without roster row
- GIVEN a `tecnico` user not linked to any roster row
- WHEN they open `/mis-numeros`
- THEN the empty state shows and the response is not an error

#### Scenario: Month with no data
- GIVEN no orders or hours in the selected month
- WHEN an administrador opens it
- THEN the empty copy shows and no chart errors occur

### Requirement: Charts and Exact Numbers

The received-vs-closed trend SHOULD be a line chart (`@uiarc/line-chart`, two series, on `/metrics` only), hours SHOULD be a bar chart (`@uiarc/bar-chart`: per technician for the selected month on `/metrics`, per month on `/mis-numeros`), and backlog counters on `/metrics` SHOULD be animated counters (`@uiarc/animated-counter`, `locale="es-PA"`), which MUST respect reduced motion. Charts MUST NOT be the only carrier of a number: every plotted value MUST also be available as text in a table on the same page, readable without hover, scrubbing or JS-only interaction. Chart touch interaction MUST NOT block vertical page scroll.

#### Scenario: Numbers in a table
- GIVEN the 6-month trend chart is rendered
- WHEN a user reads only the page text
- THEN each month's received, closed and hours values are present in a table

#### Scenario: Reduced motion
- GIVEN `prefers-reduced-motion: reduce`
- WHEN counters render
- THEN no count-up animation plays and the final value shows

### Requirement: Phone and Tablet Layouts

Both pages MUST be usable at 390px and 768px: no horizontal page overflow (wide tables scroll inside their own container), controls meet the 44x44 touch floor, and nothing depends on a secure-context-only browser API (works over `http://<LAN-IP>:3000`).

#### Scenario: 390px
- GIVEN a 390px viewport
- WHEN `/metrics` renders with data
- THEN the page has no horizontal overflow

### Requirement: No Prices

The pages MUST NOT display or compute prices, revenue or monetary amounts.

#### Scenario: No money
- GIVEN orders with priced work
- WHEN either page renders
- THEN no currency amount appears

### Requirement: Navigation Entries

The sidebar MUST show "Métricas" (`/metrics`) only to users holding `metrics.read`, and "Mis números" (`/mis-numeros`) to `tecnico`.

#### Scenario: Role entries
- GIVEN a `jefe_taller` and a `tecnico`
- WHEN each sees the sidebar
- THEN jefe sees "Métricas" and the técnico sees only "Mis números"
