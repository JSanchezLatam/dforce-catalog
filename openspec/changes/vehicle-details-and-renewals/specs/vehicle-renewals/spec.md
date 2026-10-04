# Vehicle Renewals Specification

## Purpose

Track when a vehicle's plate renewal and insurance fall due, so the workshop can contact the customer. Times are Panamá time. The renewal month and insurance expiry are INTERNAL fields: only roles holding `vencimientos.read` see or edit them.

## Requirements

### Requirement: Internal Renewal Fields

A vehicle MAY carry a plate renewal month (1-12) and an insurance expiry date (date-only, no time zone shift). Both MUST be visible and editable only for a session with `vencimientos.read`. The server MUST refuse either field from a session without it, and MUST leave the stored values unchanged when such a session saves the vehicle.

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
- THEN no renewal month or insurance expiry control MUST appear

### Requirement: Plate Due Window

A plate MUST be due when its renewal month equals the current or the next calendar month in Panamá time, wrapping December to January. A plate whose renewal month was one or two months ago MUST be listed as overdue until marked "Contactado"; three or more months ago it MUST NOT be listed, and it returns in next year's cycle (owner, 2026-10-04). A plate with no renewal month MUST never be due.

#### Scenario: Current and next month
- GIVEN today is 2026-10-04 in Panamá
- WHEN the due list is computed
- THEN vehicles with renewal month 10 or 11 MUST be due, month 9 or 8 MUST be overdue, and month 12 or 7 MUST NOT be listed

#### Scenario: Plate entered long after its month waits for next year
- GIVEN today is 2026-10-04 and a vehicle's renewal month is 3
- WHEN the due list is computed
- THEN the plate MUST NOT be listed, and on 2027-02-01 it MUST be due for period 2027-03

#### Scenario: December wraps to January
- GIVEN today is 2026-12-20 in Panamá
- WHEN the due list is computed
- THEN vehicles with renewal month 12 or 1 MUST be due and month 2 MUST NOT

#### Scenario: Overdue wraps back over January
- GIVEN today is 2027-01-10 in Panamá
- WHEN the due list is computed
- THEN month 11 and 12 MUST be overdue for periods 2026-11 and 2026-12, and month 10 MUST NOT be listed

#### Scenario: Panamá date decides the month
- GIVEN the instant 2026-10-01T03:00:00Z (still 30 September in Panamá)
- WHEN the due list is computed
- THEN the current month MUST be 9

### Requirement: Insurance Due Window

Insurance MUST be due when its expiry date is within 30 days after today (inclusive) in Panamá time, or already past. An overdue item MUST remain listed until marked "Contactado". Expiry more than 30 days away MUST NOT be due.

#### Scenario: Within 30 days
- GIVEN today is 2026-10-04 and expiry is 2026-11-03
- WHEN the due list is computed
- THEN the vehicle MUST be due; with expiry 2026-11-04 it MUST NOT

#### Scenario: Overdue stays listed
- GIVEN expiry 2026-09-01 and no "Contactado"
- WHEN the due list is computed
- THEN the vehicle MUST be listed as overdue

### Requirement: Contactado Per Vehicle, Kind and Period

Marking "Contactado" MUST record one mark per vehicle, kind (`placa`/`seguro`) and period (`YYYY-MM` for plate; the expiry date for insurance). It MUST hide that item from the list and MUST be idempotent. A mark for one period MUST NOT hide a later period. Action gated by `vencimientos.contact`; success MUST show a toast.

#### Scenario: Marking hides the item
- GIVEN a due plate item with its "Contactar" dialog open
- WHEN an administrador presses "Marcar como contactado"
- THEN the item MUST leave the list and a success toast MUST show

#### Scenario: Marking twice is idempotent
- GIVEN an item already marked
- WHEN the same mark is submitted again
- THEN the request MUST succeed and exactly one mark row MUST exist

#### Scenario: New insurance expiry resets it
- GIVEN insurance marked for expiry 2026-11-01
- WHEN the expiry is changed to 2027-11-01 and falls in the window
- THEN the item MUST be listed again unmarked

#### Scenario: Plate resets next year
- GIVEN plate marked for period 2026-10
- WHEN the due list is computed in 2027-10
- THEN the item MUST be listed again

### Requirement: Contactar Dialog

Each row's action MUST be "Contactar", opening a dialog (not a page) with: an optional numeric "Precio" in balboas; a read-only preview of the contact message; a "WhatsApp" button; a disabled "Correo" button labelled "Próximamente"; and "Marcar como contactado", which records the Contactado mark. "WhatsApp" MUST open `https://wa.me/<digits>?text=<message URL-encoded>` in a new tab, with the customer's phone in international digits (`507` added to a local Panamá mobile). Opening WhatsApp MUST NOT mark the item contacted. When the customer has `whatsappOptOut = true`, "WhatsApp" MUST be disabled with the reason "El cliente pidió no recibir WhatsApp"; `emailOptOut` MUST NOT affect it.

#### Scenario: WhatsApp link encodes the message
- GIVEN a customer phone `6111-1111` and a message containing spaces, accents and `B/. 45.00`
- WHEN the dialog renders
- THEN the WhatsApp link MUST be `https://wa.me/50761111111?text=` followed by the URL-encoded message, opening in a new tab

#### Scenario: Opening WhatsApp leaves the item uncontacted
- GIVEN a due item
- WHEN the administrador opens the WhatsApp link and closes the dialog
- THEN no Contactado mark MUST exist, no toast MUST show, and the item MUST stay listed

#### Scenario: Opt-out disables WhatsApp
- GIVEN a customer with `whatsappOptOut = true` and `emailOptOut = false`
- WHEN the dialog renders
- THEN "WhatsApp" MUST be disabled and show "El cliente pidió no recibir WhatsApp", and "Marcar como contactado" MUST still work

#### Scenario: Email is not built
- GIVEN any due item
- WHEN the dialog renders
- THEN "Correo" MUST be disabled and labelled "Próximamente"

### Requirement: Contact Message

The message MUST be built by a pure function from `workshop_config` (name, phone, hours, address), the vehicle and the due item, in the "usted" form. Plate: "Hola {cliente}, le saludamos de {taller}. La renovación de la placa de su {marca modelo} ({placa}) corresponde en {mes}. Le ofrecemos el servicio de renovación{ por B/. precio}. Si le interesa, responda este mensaje o llámenos al {teléfono taller}. Horario: {horario}. Dirección: {dirección}." Insurance: the same, with "el seguro de su {marca modelo} ({placa}) vence el {dd/mm/aaaa}", or "venció el" when overdue. A price MUST be formatted `B/. 45.00`; an empty price MUST omit the " por B/. …" fragment entirely. A null workshop field MUST omit its fragment. Missing make and model MUST read "vehículo".

#### Scenario: Price present
- GIVEN a plate item due 2026-11 and price 45
- WHEN the message is built
- THEN it MUST contain "corresponde en noviembre de 2026" and "Le ofrecemos el servicio de renovación por B/. 45.00."

#### Scenario: Price absent
- GIVEN the same item with an empty price
- WHEN the message is built
- THEN it MUST contain "Le ofrecemos el servicio de renovación." and MUST NOT contain "B/."

#### Scenario: Overdue insurance wording
- GIVEN today 2026-10-04 and insurance expiry 2026-09-01
- WHEN the message is built
- THEN it MUST contain "venció el 01/09/2026"; with expiry 2026-10-20 it MUST contain "vence el 20/10/2026"

#### Scenario: Missing workshop fields are omitted
- GIVEN `workshop_config` with name set and phone, hours and address null
- WHEN the message is built
- THEN it MUST contain neither "llámenos", "Horario:" nor "Dirección:", and no "null" or empty placeholder

#### Scenario: Missing make and model
- GIVEN a vehicle with no make and no model, plate `ABC123`
- WHEN the message is built
- THEN it MUST contain "su vehículo (ABC123)"

### Requirement: Vencimientos Próximos Page and Badge

The page "Vencimientos próximos" MUST compute the list on open, show each item's customer, plate, kind, due date or month and overdue state, and be usable on a phone, with 44x44 action targets. The sidebar item MUST show a count equal to the page's row count (due and not contacted). Mixed plate and insurance items for one vehicle count separately.

#### Scenario: Badge equals rows
- GIVEN 3 due items, 1 marked "Contactado"
- WHEN an administrador loads any page
- THEN the badge MUST show 2 and the page MUST list 2 rows

#### Scenario: Badge clears
- GIVEN no due unmarked items
- WHEN the shell renders
- THEN no badge MUST show

### Requirement: Admin-Only Access

Actions `vencimientos.read` and `vencimientos.contact` MUST be true for `administrador` and false for `tecnico`. Page, nav item, badge and contact route MUST all be gated.

#### Scenario: Technician is refused
- GIVEN a tecnico session
- WHEN it opens the page or posts a contact mark
- THEN the system MUST refuse (403 or redirect) and the nav MUST show no item or badge

#### Scenario: Real SQL
- GIVEN a database with vehicles across windows and an existing mark
- WHEN the due query and the contact insert run (e2e)
- THEN results MUST match the window rules and a duplicate insert MUST not error

## Open

Approved by the owner with the mockup 2026-10-04, no longer open: estilo list Sedán, Hatchback, SUV, Pick-up, Van/Panel, Coupé, Moto, Otro; colors are free text; the badge counts due-and-not-contacted items (a vehicle due on plate and insurance counts 2). The "Contactar" dialog is an owner decision of the same date.

Also approved by the owner 2026-10-04, no longer open: the disabled-WhatsApp reason when the phone is not a mobile ("El teléfono del cliente no es un celular"), and the overdue plate wording ("correspondía en {mes}", against "corresponde en {mes}" when not yet overdue).
