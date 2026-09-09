# Delta for table-sorting

## MODIFIED Requirements

### Requirement: Unsorted Default Is Byte-Identical to Pre-Change Behavior

A user who never interacts with sorting MUST see the exact same row order as
before this change, on customers, inventory, and users — `desc(createdAt)`
for customers, `asc(name)` for inventory, and the existing unspecified
`SELECT` order for users (no `ORDER BY` is added there). Service orders is
the deliberate exception: its unsorted default changed under
`service-orders`' *Unsorted Default Order Is Appointment-First* requirement,
to `appointmentAt` DESC nulls last with `desc(createdAt)` as tiebreak — this
requirement's byte-identical guarantee no longer covers that one table.
(Previously: this requirement's byte-identical guarantee covered all four
tables, including service orders' `desc(createdAt)` default.)

#### Scenario: No sort parameter present (customers, inventory, users)

- GIVEN customers, inventory, or users with no `sort` or `dir` in the URL (or, for users, no sort interaction)
- WHEN the list renders
- THEN row order MUST be identical to that table's order before this change shipped

#### Scenario: Service orders default order is the named exception

- GIVEN the `/service-orders` list with no `sort` or `dir` in the URL
- WHEN the list renders
- THEN row order MUST follow `service-orders`' `appointmentAt` DESC nulls-last default, not `desc(createdAt)` — this requirement no longer covers that table

### Requirement: NULL Ordering for Nullable Sort Columns

`appointmentAt` (service orders) and users' `name` and `email` MAY be NULL.
Rows with a NULL value in the active sort column MUST sort last, regardless
of ascending or descending direction — a missing value is never more
prominent than a present one, in either direction. This guarantee also
covers service orders' unsorted default (`appointmentAt` DESC, no explicit
`sort` in the URL, per `service-orders`' *Unsorted Default Order Is
Appointment-First*): orders with no `appointmentAt` MUST sort last there too,
not only when `appointmentAt` is an explicitly-clicked sort column.
(Previously: NULL-last applied only to an explicitly active sort column; the
unsorted service-orders default was not covered by this guarantee.)

#### Scenario: NULL appointment sorts last ascending

- GIVEN service orders where some have `appointmentAt = NULL`
- WHEN staff sorts ascending by `appointmentAt`
- THEN rows with a NULL `appointmentAt` MUST appear after every row with a real date

#### Scenario: NULL appointment sorts last descending

- GIVEN the same data
- WHEN staff sorts descending by `appointmentAt`
- THEN rows with a NULL `appointmentAt` MUST still appear last, not first

#### Scenario: NULL appointment sorts last in the unsorted default too

- GIVEN service orders where some have `appointmentAt = NULL`, and no `sort` in the URL
- WHEN the list renders under its unsorted default
- THEN rows with a NULL `appointmentAt` MUST appear after every row with a real date
