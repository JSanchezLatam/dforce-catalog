# Delta Spec: service-orders (service-order-reception)

Vehicle intake records mileage and fuel/battery level, creation lands on the new order, and reception photos evidence the vehicle's condition. All user-facing copy is Spanish.

## ADDED Requirements

### Requirement: Vehicle Intake Fields

`orden_servicio` MUST carry three optional intake fields: `kilometraje` (integer >= 0), `nivel_combustible` (integer 0..4, rendered Vacío, 1/4, 1/2, 3/4, Lleno for 0, 1, 2, 3, 4) and `bateria_pct` (integer 0..100). Each MUST be settable at creation and through the order edit path (existing edit gate unchanged), and each range MUST also be enforced at the database level. The form MUST show inputs by the order vehicle's `motor`: `combustion` shows fuel only; `electrico` shows battery only; `hibrido` shows both; unset motor shows both. All are optional in every case.

#### Scenario: Inputs follow motor
- GIVEN vehicles with motor combustion, electrico, hibrido and unset
- WHEN staff opens the order form for each
- THEN the form MUST show fuel only, battery only, both, and both respectively

#### Scenario: Valid values persist
- GIVEN `kilometraje = 85000`, `nivel_combustible = 2`, `bateria_pct = 100`
- WHEN the order is saved
- THEN the system MUST persist all three

#### Scenario: Out-of-range values rejected
- GIVEN `kilometraje = -1`, `1.5` or `"abc"`; or `nivel_combustible = 5`; or `bateria_pct = 101`
- WHEN staff submits
- THEN the system MUST reject it with a Spanish validation error and persist nothing; a direct insert violating a range MUST be rejected by the database

#### Scenario: Intake optional
- GIVEN a create payload with none of the three fields
- WHEN the order is created
- THEN the system MUST accept it and store null for each

#### Scenario: Fuel labels
- GIVEN orders with `nivel_combustible` 0, 1, 2, 3, 4
- WHEN staff opens each detail view
- THEN it MUST show Vacío, 1/4, 1/2, 3/4, Lleno respectively

### Requirement: Navigate to Order Detail After Creation

After a successful "Crear", the system MUST navigate to the new order's detail page.

#### Scenario: Create lands on detail
- GIVEN a valid order form
- WHEN staff submits it and the server accepts
- THEN the browser MUST navigate to `/service-orders/<new id>`

#### Scenario: Failed create stays put
- GIVEN a submission the server rejects
- WHEN the response arrives
- THEN the form MUST stay open with the error and MUST NOT navigate

### Requirement: Reception Photos

An order MUST hold up to 12 reception photos, stored as JPEG in object storage under `service-orders/<ordenId>/<photoId>.jpg` with a server-generated id, listed by `position` ascending. The server MUST accept a file only if its leading bytes are a JPEG signature (the declared content type MUST NOT be trusted) and its size is at most 3 MB. Photo bytes MUST be served only through an authenticated same-origin route to sessions holding `service-orders.read`. Adding MUST be allowed to any role holding `service-orders.write` while the order is `open` or `in_progress`, and refused when `done` or `cancelled`. Deleting MUST be allowed only to `administrador` while `open` or `in_progress`; any other role MUST receive 403. Photos MUST never be removed by retention. The order detail MUST show a "Fotos de recepción" card.

#### Scenario: Valid JPEG added
- GIVEN an `open` order with 0 photos and a session with `service-orders.write`
- WHEN a valid 500 KB JPEG is uploaded
- THEN the system MUST store it at position 0 and list it

#### Scenario: Non-JPEG refused
- GIVEN a PNG, or a non-image file labelled `image/jpeg`
- WHEN it is uploaded
- THEN the system MUST refuse it with a Spanish message and store nothing

#### Scenario: Oversize refused
- GIVEN a valid JPEG larger than 3 MB
- WHEN it is uploaded
- THEN the system MUST refuse it with a Spanish message

#### Scenario: Thirteenth photo refused
- GIVEN an order with 12 photos
- WHEN a 13th is uploaded
- THEN the system MUST refuse it with a Spanish message and the order MUST still hold 12

#### Scenario: Ordered by position
- GIVEN photos added in sequence A, B, C
- WHEN the order's photos are listed or printed
- THEN they MUST appear A, B, C

#### Scenario: Add gated by status
- GIVEN a `tecnico` and orders in each status
- WHEN the técnico uploads a photo
- THEN it MUST succeed for `open` and `in_progress` and be refused for `done` and `cancelled`

#### Scenario: Delete is administrador-only
- GIVEN an `in_progress` order with a photo
- WHEN a `tecnico` deletes it THEN the system MUST respond 403 and keep it; WHEN an `administrador` deletes it THEN the photo and its stored object MUST be removed

#### Scenario: Delete refused on closed order
- GIVEN a `done` or `cancelled` order with a photo
- WHEN an `administrador` deletes it
- THEN the system MUST refuse it

#### Scenario: Serving is authenticated
- GIVEN a photo URL
- WHEN requested with no session, or a session lacking `service-orders.read`
- THEN the system MUST NOT return the bytes; with such a session it MUST return the JPEG

#### Scenario: Retention spares photos
- GIVEN a retention run
- WHEN it executes
- THEN no object under `service-orders/` MUST be deleted

## MODIFIED Requirements

### Requirement: Service Order Detail Displays Vehicle, Category, and Notes

The order detail view MUST display the order's vehicle (identified at minimum by plate) as a link to that vehicle's detail screen, with any set chasis, colors, estilo, motor and unit number, its `categoria`, and its `hallazgos`/`recomendaciones`/`observaciones` fields. The unit number MUST render only when filled. The plate renewal month and insurance expiry MUST NEVER render, for any role. A field not yet set MUST render an explicit empty-state placeholder, never a blank row. An order whose vehicle has been deactivated (soft-deleted) MUST still render its vehicle identity and link, exactly as for an active vehicle. The view MUST also show the order's `kilometraje`, with the visible text "Sin kilometraje" when null, and its fuel level and battery percentage when set.
(Previously: no intake fields on the detail view.)

#### Scenarios

- GIVEN an order with a vehicle and a `categoria` WHEN staff opens its detail view THEN the system MUST show the vehicle's plate as a link to `/customers/[id]/vehicles/[vehicleId]` and the `categoria` as text
- GIVEN an order that has not yet been completed WHEN staff opens its detail view THEN the system MUST show a placeholder for each unset note field
- GIVEN an order whose vehicle has since been deactivated WHEN staff opens the order's detail view THEN the system MUST still show that vehicle's identity and link
- GIVEN a vehicle with chasis, colors, estilo and motor set and no unit number WHEN staff opens the order's detail view THEN those fields MUST show and no unit number label MUST appear; with a unit number set it MUST appear
- GIVEN a vehicle whose internal fields hold sentinel values WHEN an administrador opens the order's detail view THEN the rendered output MUST contain neither the renewal month nor the insurance expiry sentinel
- GIVEN an order with `kilometraje = 85000` WHEN staff opens its detail view THEN it MUST show "85.000 km"
- GIVEN an order with null `kilometraje` WHEN staff opens its detail view THEN it MUST show "Sin kilometraje"
- GIVEN an order with `bateria_pct = 80` and `nivel_combustible = 3` WHEN staff opens its detail view THEN it MUST show 80% and 3/4

### Requirement: Printable Work Order

The system MUST provide a print view for an existing `orden_servicio`, reachable via an "Imprimir" action on that order's detail page, gated by `service-orders.read`. The view MUST NOT auto-open on order creation. Printing it (`@media print` + `window.print()`) MUST produce a first page carrying: cliente (nombre, teléfono, and Cédula / RUC beside them when set), vehículo (placa, marca, modelo, año, plus any set chasis, colores, estilo and motor, and the unit number only when filled), the intake rows (kilometraje, and fuel and battery when set), categoría, fecha y hora de inicio, descripción, and observaciones. The sheet MUST NEVER carry the plate renewal month or insurance expiry. The first page MUST also reserve blank ruled space under a "Trabajo realizado / Hallazgos" heading, with a signature line — layout only, with no backing database column. The top-right of the first page MUST hold a blank square slot of about 25 mm, with no border and no text, reserved for a future QR code. Reception photos MUST print 4 per sheet starting on page 2, in position order; an order with no photos MUST print exactly one page.
(Previously: vehículo carried placa, marca, modelo, año only, and the sheet was a single page with no intake rows, Cédula / RUC, QR slot or photos.)

*(Amended 2026-09-09 by `fix/printed-order-polish` — five owner-reported
defects on one surface, judged too small for a change folder. Recorded here
because a baseline nobody can trace is the same problem as a baseline that is
wrong; the next reader should look for the PR, not for a delta.)*

The sheet MUST identify the workshop that produced it, carrying the `workshop_config` singleton's name and logo — the same record and the same `/api/workshop-config/logo` route the generated catalog already consumes. Both columns are nullable and each renders only when set: a missing logo MUST leave no broken image.

Field labels MUST be red, unconditionally rather than `print:`-scoped, so the sheet reads the same on screen and on paper.

The view MUST offer a control back to the order it prints, and that control — like the print control itself — MUST be absent from the printed sheet.

Printing MUST target **Letter** explicitly and the sheet MUST fill the printable box. With no `@page` rule the browser takes its size from the print dialog's default, which is per-user and locale-dependent, and the screen's centred card width leaves a small block adrift in the middle of the page.

Printing MUST produce a light sheet regardless of the app's theme. The `(app)` shell paints `body` and its content container from the theme, so with a dark theme selected the shell prints as a black page around a white sheet; the print rules MUST force those surfaces light rather than relying on the browser's per-user "background graphics" setting.

#### Scenario: The sheet names the workshop
- GIVEN a `workshop_config` row with a name and a logo
- WHEN the print view renders
- THEN the sheet MUST show that name and that logo

#### Scenario: A workshop with no logo prints no broken image
- GIVEN a `workshop_config` row whose logo is unset
- WHEN the print view renders
- THEN no image element MUST be rendered

#### Scenario: The back control never reaches the paper
- GIVEN the print view
- WHEN it renders
- THEN it MUST offer a control back to that order, excluded from the printed output

#### Scenario: Imprimir navigates to the print view
- GIVEN an order detail page
- WHEN staff clicks "Imprimir"
- THEN the system MUST navigate to that order's print view

#### Scenario: Printed page carries the order's data
- GIVEN the print view for an order with all fields set
- WHEN it is printed
- THEN the page MUST show cliente, vehículo, categoría, fecha y hora de inicio, descripción, and observaciones

#### Scenario: Printed page reserves handwriting space
- GIVEN the print view
- WHEN it is printed
- THEN it MUST show blank ruled space under "Trabajo realizado / Hallazgos" with a signature line, backed by no stored field

#### Scenario: Print view enforces the same read gate
- GIVEN a session without `service-orders.read`
- WHEN it requests an order's print view
- THEN the system MUST refuse it exactly as any other order-read route

#### Scenario: New vehicle fields on the sheet
- GIVEN a vehicle with chasis, colors, estilo, motor and a unit number
- WHEN the print view renders
- THEN the vehículo block MUST show them beside placa, marca, modelo and año; without a unit number, no unit label MUST appear

#### Scenario: Internal fields absent from the sheet
- GIVEN a vehicle whose internal fields hold sentinel values
- WHEN the print view renders for an administrador
- THEN the output MUST contain neither sentinel

#### Scenario: Cédula / RUC and intake on page 1
- GIVEN an order whose customer has a Cédula / RUC and whose intake fields are set
- WHEN the print view renders
- THEN the first page MUST show the Cédula / RUC beside nombre and teléfono, and the kilometraje, fuel and battery rows

#### Scenario: QR slot is blank
- GIVEN the print view
- WHEN it renders
- THEN a ~25 mm square slot MUST exist at the first page's top-right containing no text and no visible border

#### Scenario: Photos print 4 per sheet from page 2
- GIVEN an order with 9 photos
- WHEN it is printed
- THEN photos MUST start on page 2, 4 on each of pages 2 and 3 and 1 on page 4, with the signature on page 1

#### Scenario: Photo-less order is one page
- GIVEN an order with 0 photos
- WHEN it is printed
- THEN the output MUST be exactly one page, signature line included
