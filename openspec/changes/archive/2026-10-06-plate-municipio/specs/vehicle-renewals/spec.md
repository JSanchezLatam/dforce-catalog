# Delta for Vehicle Renewals

## MODIFIED Requirements

### Requirement: Internal Renewal Fields

A vehicle MAY carry a plate renewal month (1-12), an insurance expiry date (date-only, no time zone shift) and a plate municipio (free text, the municipio that issued the plate). All three MUST be visible and editable only for a session with `vencimientos.read`. The server MUST refuse any of them from a session without it, and MUST leave the stored values unchanged when such a session saves the vehicle. The municipio MUST be trimmed on save, an empty or whitespace-only value MUST be stored as null, and it MUST NOT exceed 80 characters. Omitting the municipio on save MUST leave it unchanged. It MUST NOT appear on the service order, the printed sheet, the customer portal or the public vehicles API.
(Previously: only the renewal month and insurance expiry were internal fields.)

#### Scenario: Administrador edits internal fields
- GIVEN an administrador on a vehicle's form
- WHEN they set renewal month 3 and insurance expiry 2026-11-15 and save
- THEN both values MUST be stored and shown again on reopening

#### Scenario: Month out of range is rejected
- GIVEN an administrador saving a vehicle
- WHEN the renewal month is 0 or 13
- THEN the system MUST reject it with a Spanish validation error

#### Scenario: Technician form hides the section
- GIVEN a tecnico on a vehicle's form
- WHEN the form renders
- THEN no renewal month, insurance expiry or municipio control MUST appear

#### Scenario: Municipio is trimmed and shown
- GIVEN an administrador on a vehicle's form
- WHEN they enter "  San Miguelito " as municipio and save
- THEN "San Miguelito" MUST be stored and shown on the vehicle detail page and on reopening the form

#### Scenario: Blank municipio becomes null
- GIVEN a vehicle with municipio "David"
- WHEN an administrador saves it with the municipio field blank or spaces only
- THEN the stored municipio MUST be null and no municipio MUST be shown

#### Scenario: Municipio too long is rejected
- GIVEN an administrador saving a vehicle
- WHEN the municipio is 81 characters long
- THEN the system MUST reject it with a Spanish validation error, and with 80 characters it MUST accept it

#### Scenario: Technician save preserves the municipio
- GIVEN a vehicle with municipio "David" and a tecnico session
- WHEN the tecnico saves the vehicle without sending the municipio
- THEN the stored municipio MUST remain "David"

#### Scenario: Technician sending the municipio is refused
- GIVEN a tecnico session
- WHEN it saves a vehicle including a municipio value
- THEN the server MUST refuse the request and store nothing

#### Scenario: Municipio never leaks
- GIVEN a vehicle with a municipio set
- WHEN its service order, printed sheet, customer portal or `GET /api/customers/[id]/vehicles` is rendered
- THEN the municipio value MUST NOT appear

### Requirement: Vencimientos Próximos Page and Badge

The page "Vencimientos próximos" MUST compute the list on open, show each item's customer, plate, kind, due date or month and overdue state, and be usable on a phone, with 44x44 action targets. When the vehicle has a municipio, each plate row MUST also show it, wrapping on a narrow screen without breaking the row; an insurance row MUST NOT show it; when the vehicle has none, nothing MUST be shown in its place. The sidebar item MUST show a count equal to the page's row count (due and not contacted). Mixed plate and insurance items for one vehicle count separately.
(Previously: rows did not show the plate municipio.)

#### Scenario: Badge equals rows
- GIVEN 3 due items, 1 marked "Contactado"
- WHEN an administrador loads any page
- THEN the badge MUST show 2 and the page MUST list 2 rows

#### Scenario: Badge clears
- GIVEN no due unmarked items
- WHEN the shell renders
- THEN no badge MUST show

#### Scenario: Row shows the municipio
- GIVEN a due plate item whose vehicle has municipio "San Miguelito"
- WHEN an administrador opens the page
- THEN that row MUST show "San Miguelito"

#### Scenario: Insurance row does not show the municipio
- GIVEN a due insurance item whose vehicle has municipio "San Miguelito"
- WHEN an administrador opens the page
- THEN that row MUST NOT show "San Miguelito"

#### Scenario: Row without municipio
- GIVEN a due plate item whose vehicle has no municipio
- WHEN the page renders
- THEN the row MUST show no municipio text, "null" or placeholder
