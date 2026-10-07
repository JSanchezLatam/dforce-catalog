# Delta for service-orders

The printable work order gains the consent clause, a customer signature line, and a separate "Copia del cliente" print carrying the QR. Order fields gain a "Visible para el cliente" hint. Sheets and clause text are provisional until legal review.

## MODIFIED Requirements

### Requirement: Printable Work Order

The system MUST provide a print view for an existing `orden_servicio`, reachable via an "Imprimir" action on that order's detail page, gated by `service-orders.read`. The view MUST NOT auto-open on order creation. Printing it (`@media print` + `window.print()`) MUST produce a first page carrying: cliente (nombre, teléfono, and Cédula / RUC beside them when set), vehículo (placa, marca, modelo, año, plus any set chasis, colores, estilo and motor, and the unit number only when filled), the intake rows (kilometraje, and fuel and battery when set), categoría, fecha y hora de inicio, descripción, and observaciones. The sheet MUST NEVER carry the plate renewal month or insurance expiry. The first page MUST also reserve blank ruled space under a "Trabajo realizado / Hallazgos" heading, with a signature line — layout only, with no backing database column. The top-right of the first page MUST hold a square slot of about 25 mm, with no border and no text. On this workshop copy the slot MUST stay blank; the QR code prints only on the customer copy (see Customer Copy With Portal QR). Reception photos MUST print 4 per sheet starting on page 2, in position order; an order with no photos MUST print exactly one page.

WHEN the order's customer holds a current consent (see `customer-management`), the first page MUST also carry the provisional consent clause, beginning with the banner "Texto provisorio — pendiente de revisión legal", followed by a ruled line labelled "Firma del cliente" for the customer to sign. WHEN the customer holds no current consent, neither the clause nor the "Firma del cliente" line MUST print. The clause and signature line MUST NOT push the existing signature line off the first page: a photo-less order MUST still print exactly one page.
(Previously: the top-right slot was reserved for a future QR code on every print, and the sheet carried no consent clause or customer signature line.)

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

#### Scenario: QR slot stays blank on the workshop copy
- GIVEN the workshop copy print view, for a customer with or without consent
- WHEN it renders
- THEN a ~25 mm square slot MUST exist at the first page's top-right containing no text, no visible border and no QR

#### Scenario: Consent clause and customer signature for a consented customer
- GIVEN an order whose customer holds current consent
- WHEN the workshop copy renders
- THEN the first page MUST show the clause beginning "Texto provisorio — pendiente de revisión legal" and a "Firma del cliente" line, and the "Trabajo realizado / Hallazgos" signature line MUST still be on page 1

#### Scenario: No clause or signature line without consent
- GIVEN an order whose customer holds no current consent
- WHEN the workshop copy renders
- THEN neither the clause nor "Firma del cliente" MUST appear

#### Scenario: Photos print 4 per sheet from page 2
- GIVEN an order with 9 photos
- WHEN it is printed
- THEN photos MUST start on page 2, 4 on each of pages 2 and 3 and 1 on page 4, with the signature on page 1

#### Scenario: Photo-less order is one page
- GIVEN an order with 0 photos, whose customer holds current consent
- WHEN it is printed
- THEN the output MUST be exactly one page, clause and both signature lines included

## ADDED Requirements

### Requirement: Customer Copy With Portal QR

The system MUST provide a second print of an order, titled "Copia del cliente", reachable from the print view by a control, gated by `service-orders.read`. It is the only print that carries the QR. The workshop keeps the signed workshop copy; the customer takes this copy.

The customer copy MUST show, at the first page's top-right 25 mm slot, a QR code that encodes `<PORTAL_BASE_URL>/c#<token>` (the token in the URL fragment, so it never reaches a server log), rendered as SVG on the server so the page needs no secure-context browser API. Below or beside it MUST be the notice "Este código da acceso a tu historial. No lo compartas.". The copy MUST carry the order's identifying data (N.º, cliente nombre, vehículo, categoría, fecha y hora de inicio, descripción) and MUST NOT carry the "Firma del cliente" line, the signature block, photos, or any field the sheet never carries (renewal month, insurance expiry).

The QR MUST print ONLY when ALL hold: the customer holds a current consent, the customer holds a token, the customer is active, and `PORTAL_BASE_URL` is set. When any is false the QR and its notice MUST NOT render, the slot MUST stay blank, and the control to open the customer copy MUST NOT be offered. The page MUST render with no error when the QR is withheld. The token MUST NOT appear anywhere else in the HTML than as the encoded QR and MUST NOT be sent to a client component bundle.

#### Scenario: QR prints for a consented, active customer
- GIVEN a customer with current consent, a token, and `PORTAL_BASE_URL` set
- WHEN staff opens "Copia del cliente"
- THEN the first page MUST show a QR in the top-right slot and the notice "Este código da acceso a tu historial. No lo compartas."

#### Scenario: No consent means no QR
- GIVEN a customer with no current consent
- WHEN staff views the order's print options
- THEN no QR MUST render anywhere and the "Copia del cliente" control MUST NOT be offered

#### Scenario: No PORTAL_BASE_URL means no QR
- GIVEN a consented customer and `PORTAL_BASE_URL` unset
- WHEN staff views the print options
- THEN no QR MUST render and the page MUST NOT error

#### Scenario: Deactivated customer gets no QR
- GIVEN a consented but deactivated customer
- WHEN their order's print is opened directly
- THEN no QR MUST render

#### Scenario: Customer copy has no signature block
- GIVEN the "Copia del cliente"
- WHEN it renders
- THEN it MUST NOT contain "Firma del cliente" or the "Trabajo realizado / Hallazgos" signature block

#### Scenario: Customer copy never carries internal fields
- GIVEN a vehicle whose internal fields hold sentinel values
- WHEN the customer copy renders
- THEN the output MUST contain neither sentinel

#### Scenario: Customer copy is one page
- GIVEN an order with 9 photos
- WHEN the customer copy is printed
- THEN the output MUST be exactly one page

#### Scenario: Customer copy enforces the read gate
- GIVEN a session without `service-orders.read`
- WHEN it requests the customer copy
- THEN the system MUST refuse it exactly as the workshop copy

### Requirement: Fields Visible to the Customer Are Marked

Wherever staff edit or read an order's `description`, `hallazgos` or `recomendaciones` — the create dialog (for `description`), the edit form, and the detail view — the field MUST carry the hint "Visible para el cliente", because those three fields are copied to the customer portal. `observaciones` and every other order field MUST NOT carry the hint. The hint MUST show for every customer regardless of consent, so staff never have to know a customer's consent state to know how to write.

#### Scenario: Hint on the three fields
- GIVEN the order edit form
- WHEN it renders
- THEN `description`, `hallazgos` and `recomendaciones` MUST each show "Visible para el cliente"

#### Scenario: No hint on observaciones
- GIVEN the order edit form
- WHEN it renders
- THEN `observaciones` MUST NOT show "Visible para el cliente"

#### Scenario: Hint in the create dialog
- GIVEN the create-order dialog
- WHEN it renders
- THEN the `description` field MUST show the hint and no hallazgos or recomendaciones field MUST appear
