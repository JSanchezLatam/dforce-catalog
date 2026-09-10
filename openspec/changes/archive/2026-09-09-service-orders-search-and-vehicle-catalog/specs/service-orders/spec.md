# Delta for service-orders

## ADDED Requirements

### Requirement: Order List Search Matches Customer, Vehicle, and Phone

The `/service-orders` list MUST support a search filter that matches, case-
and accent-insensitively, against the order's customer `name`, vehicle
`plate`, or customer `phone` — the same three columns `buildClienteSearchWhere`
already matches for `/customers`. It MUST NOT match against `description`
(unindexed free text with no user-meaningful match, the same reason it is
excluded from `ORDEN_SORT`). The input itself follows `list-search-filters`'
controlled-input contract.

#### Scenario: Search matches by customer name
- GIVEN an order belonging to customer "Pérez"
- WHEN staff searches "perez" (no accent)
- THEN that order MUST appear in the results

#### Scenario: Search matches by vehicle plate
- GIVEN an order whose vehicle has plate "AB1234"
- WHEN staff searches "AB1234"
- THEN that order MUST appear in the results

#### Scenario: Search matches by customer phone
- GIVEN an order belonging to a customer with phone "61234567"
- WHEN staff searches "61234567"
- THEN that order MUST appear in the results

#### Scenario: Search does not match description
- GIVEN an order whose `description` contains a word absent from its customer's name, phone, and vehicle plate
- WHEN staff searches that word
- THEN that order MUST NOT appear in the results

### Requirement: Order List Columns Show Customer and Vehicle

The `/service-orders` list MUST render columns: a truncated `ID`, `Cliente`
(customer name), `Vehículo`, `Estado`, `Cita`, and `Acciones`. The `Vehículo`
cell MUST identify the car, not merely its registration: the plate AND the
make/model the workshop knows it by. The owner asked for "el auto con su
placa" and selected a mockup reading `AB-1234 Hilux`; a plate alone does not
tell a technician which car is on the lift. Make and model are nullable, so
the cell MUST degrade to the plate alone when they are absent rather than
rendering a dangling separator. It MUST NOT render a `Descripción` column. `ID` MUST display only
the first 8 characters of the order's id, in a monospace style; this is
DISPLAY-ONLY — the stored `id` MUST remain the full UUID, and the order
detail page MUST continue to show the full UUID.

#### Scenario: List shows customer and the car, not just its plate
- GIVEN an order for customer "Pérez" with a vehicle whose plate is "AB1234", make "Toyota" and model "Hilux"
- WHEN that row renders
- THEN it MUST show "Pérez" under `Cliente`, and the `Vehículo` cell MUST carry both "AB1234" and the make/model

#### Scenario: A vehicle with no make or model still renders its plate
- GIVEN an order whose vehicle has `make = NULL` and `model = NULL`
- WHEN that row renders
- THEN the `Vehículo` cell MUST show the plate alone, with no trailing separator or empty segment

#### Scenario: Descripción column is gone
- GIVEN the order list renders
- WHEN the header row is inspected
- THEN it MUST NOT contain a `Descripción` header

#### Scenario: ID renders truncated
- GIVEN an order with id `87cceecc-...`
- WHEN its row renders
- THEN the `ID` cell MUST display exactly `87cceecc` in a monospace style

#### Scenario: Detail page still shows the full id
- GIVEN an order whose list row shows a truncated id
- WHEN staff opens that order's detail page
- THEN the detail page MUST display the full, untruncated UUID

### Requirement: Unsorted Default Order Is Appointment-First

When no `sort` is present in the URL, `/service-orders` MUST order rows by
`appointmentAt` descending, NULLs last, breaking ties with `createdAt`
descending. `ORDEN_SORT` (`id`, `status`, `appointmentAt`) is UNCHANGED by
this requirement — sorting by customer name or vehicle plate is explicitly
out of scope; it would require a joined `ORDER BY` with `unaccent`/`lower`
wrapping, new SQL this change does not add.

#### Scenario: Orders with an appointment sort newest-first
- GIVEN two orders with `appointmentAt` a week apart and no `sort` in the URL
- WHEN the list renders
- THEN the order with the later `appointmentAt` MUST appear first

#### Scenario: Orders without an appointment sort last
- GIVEN one order with `appointmentAt` set and one with `appointmentAt = NULL`, no `sort` in the URL
- WHEN the list renders
- THEN the order with no appointment MUST appear after the one with an appointment

#### Scenario: appointmentAt and createdAt disagreeing exposes the correct order
- GIVEN order A created today with `appointmentAt` next week, and order B created last week with `appointmentAt` yesterday, no `sort` in the URL
- WHEN the list renders
- THEN order A MUST appear before order B — it sorts by `appointmentAt`, not `createdAt`

### Requirement: Service Due Reminder Restricted to Preventive and Corrective Categories

Transitioning an order to `done` MUST schedule a `service_due` reminder ONLY
when that order's `categoria` is `mant_preventivo` or `mant_correctivo`.
Transitioning an order of any other category (`instalacion`, `reparacion`,
`revisado`) to `done` MUST NOT schedule a `service_due` reminder. This
REMOVES the `service_due` reminder for those three categories — behavior the
code currently provides (all five categories schedule it) but that has never
been specified until now. `revisado`'s own annual (not 90-day) reminder is a
named follow-up, not delivered by this requirement.

#### Scenario: Preventive maintenance schedules service_due
- GIVEN an order with `categoria = "mant_preventivo"`
- WHEN it transitions to `done`
- THEN a `service_due` reminder MUST be scheduled

#### Scenario: Corrective maintenance schedules service_due
- GIVEN an order with `categoria = "mant_correctivo"`
- WHEN it transitions to `done`
- THEN a `service_due` reminder MUST be scheduled

#### Scenario: Installation no longer schedules service_due
- GIVEN an order with `categoria = "instalacion"`
- WHEN it transitions to `done`
- THEN no `service_due` reminder MUST be scheduled

#### Scenario: Repair no longer schedules service_due
- GIVEN an order with `categoria = "reparacion"`
- WHEN it transitions to `done`
- THEN no `service_due` reminder MUST be scheduled

#### Scenario: REVISADO no longer schedules service_due
- GIVEN an order with `categoria = "revisado"`
- WHEN it transitions to `done`
- THEN no `service_due` reminder MUST be scheduled

## Verification Notes

The join in `listOrdenesServicio` (currently a bare `db.select().from(ordenServicio)`
with no join) is new SQL. Per `AGENTS.md`'s injected-seam limit, a green
`npm test` proves zero coverage of it — `vitest.config.ts` points
`DATABASE_URL` at a nonexistent database, so the real join branch never runs
under unit tests. An e2e row against real Postgres is a required exit
criterion, not optional, for the search-matching and column requirements
above. That fixture MUST seed orders where `appointmentAt` and `createdAt`
disagree — with only 2 near-identical rows, as exist today, the default-order
requirement is unfalsifiable.
