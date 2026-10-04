# Delta Spec: service-orders (vehicle-details-and-renewals)

The order detail and the print sheet render an allowlist of vehicle fields. The plate renewal month and insurance expiry are internal and never belong to it.

## MODIFIED Requirements

### Requirement: Service Order Detail Displays Vehicle, Category, and Notes

The order detail view MUST display the order's vehicle (identified at minimum by plate) as a link to that vehicle's detail screen, with any set chasis, colors, estilo, motor and unit number, its `categoria`, and its `hallazgos`/`recomendaciones`/`observaciones` fields. The unit number MUST render only when filled. The plate renewal month and insurance expiry MUST NEVER render, for any role. A field not yet set MUST render an explicit empty-state placeholder, never a blank row. An order whose vehicle has been deactivated (soft-deleted) MUST still render its vehicle identity and link, exactly as for an active vehicle.
(Previously: the vehicle was identified by plate only; no descriptive fields, no internal-field exclusion.)

#### Scenario: Vehicle and category shown
- GIVEN an order with a vehicle and a `categoria`
- WHEN staff opens its detail view
- THEN the system MUST show the vehicle's plate as a link to `/customers/[id]/vehicles/[vehicleId]` and the `categoria` as text

#### Scenario: Unset note fields
- GIVEN an order that has not yet been completed
- WHEN staff opens its detail view
- THEN the system MUST show a placeholder for each unset note field

#### Scenario: Deactivated vehicle
- GIVEN an order whose vehicle has since been deactivated
- WHEN staff opens the order's detail view
- THEN the system MUST still show that vehicle's identity and link

#### Scenario: Descriptive fields shown, unit number conditional
- GIVEN a vehicle with chasis, colors, estilo and motor set and no unit number
- WHEN staff opens the order's detail view
- THEN those fields MUST show and no unit number label MUST appear; with a unit number set it MUST appear

#### Scenario: Internal fields absent from order detail
- GIVEN a vehicle whose internal fields hold sentinel values
- WHEN an administrador opens the order's detail view
- THEN the rendered output MUST contain neither the renewal month nor the insurance expiry sentinel

### Requirement: Printable Work Order

The system MUST provide a print view for an existing `orden_servicio`, reachable via an "Imprimir" action on that order's detail page, gated by `service-orders.read`. The view MUST NOT auto-open on order creation. Printing it (`@media print` + `window.print()`) MUST produce one page carrying: cliente (nombre, teléfono), vehículo (placa, marca, modelo, año, plus any set chasis, colores, estilo and motor, and the unit number only when filled), categoría, fecha y hora de inicio, descripción, and observaciones. The sheet MUST NEVER carry the plate renewal month or insurance expiry. The page MUST also reserve blank ruled space under a "Trabajo realizado / Hallazgos" heading, with a signature line — layout only, with no backing database column.
(Previously: vehículo carried placa, marca, modelo, año only.)

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
