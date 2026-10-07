# Delta Spec: service-orders

Closed-order refusal is no longer absolute: an `administrador` may correct a closed order after password re-entry, under the `service-order-corrections` capability. Everything else in both requirements is unchanged.

## MODIFIED Requirements

### Requirement: Reception Photos

An order MUST hold up to 12 reception photos, stored as JPEG in object storage under `service-orders/<ordenId>/<photoId>.jpg` with a server-generated id, listed by `position` ascending. The server MUST accept a file only if its leading bytes are a JPEG signature (the declared content type MUST NOT be trusted) and its size is at most 3 MB. Photo bytes MUST be served only through an authenticated same-origin route to sessions holding `service-orders.read`. Adding MUST be allowed to any role holding `service-orders.write` while the order is `open` or `in_progress`, and refused when `done` or `cancelled` unless it is an authorized administrator correction (see `service-order-corrections`). Deleting MUST be allowed only to `administrador` while `open` or `in_progress`, or while `done` or `cancelled` under an authorized administrator correction; any other role MUST receive 403, and a closed-order delete without an authorized correction MUST be refused. Photos MUST never be removed by retention. The order detail MUST show a "Fotos de recepción" card.

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

#### Scenario: Delete refused on closed order without correction
- GIVEN a `done` or `cancelled` order with a photo
- WHEN an `administrador` deletes it with no password, or a wrong one
- THEN the system MUST refuse it and keep the photo

#### Scenario: Delete allowed on closed order under correction
- GIVEN a `done` or `cancelled` order with a photo
- WHEN an `administrador` deletes it with their correct password
- THEN the photo and its stored object MUST be removed and the deletion MUST be audited

#### Scenario: Serving is authenticated
- GIVEN a photo URL
- WHEN requested with no session, or a session lacking `service-orders.read`
- THEN the system MUST NOT return the bytes; with such a session it MUST return the JPEG

#### Scenario: Retention spares photos
- GIVEN a retention run
- WHEN it executes
- THEN no object under `service-orders/` MUST be deleted

### Requirement: Order Editing Is Gated by Role and Current Status

The system MUST expose an entry point that opens an existing `orden_servicio` in the order form's edit mode, and MUST allow that edit only when the acting user's role and the order's **current** status jointly permit it.

Today there is no entry point at all: `ServiceOrderFormTrigger` accepts an optional `order` prop that switches `ServiceOrderForm` into edit mode, and the only place it is rendered — the `/service-orders` list-page header — omits that prop, so the trigger is permanently in create mode. The order detail page offers `OrderStatusControls` and links, and no edit control. `updateOrder` and `PATCH /api/service-orders/[id]` exist and are tested; nothing in the UI reaches them, which is why `hallazgos`, `recomendaciones` and `observaciones` are unreachable after creation. This is a missing surface, not a permission denial.

The permitted combinations are exactly:

| Status | `administrador` | `tecnico` |
|---|---|---|
| `open` | MUST be allowed | MUST be refused |
| `in_progress` | MUST be allowed | MUST be allowed |
| `done` | MUST be refused, except as an audited correction with password re-entry | MUST be refused |
| `cancelled` | MUST be refused, except as an audited correction with password re-entry | MUST be refused |

The gate covers the fields the form and the patch path already carry — `categoria`, `description`, `appointmentAt`, `hallazgos`, `recomendaciones`, `observaciones`. It does not introduce parts anywhere: `producto` line items are absent from creation and from editing alike (see Service Order Creation (R20)).

`done` and `cancelled` are terminal: `assertTransition` gives them no outgoing edges, so a closed order cannot be reopened through the UI, and a correction never changes `status` or `completedAt`. Closed orders refuse `tecnico` always and `administrador` by default; the only way through is the administrator correction defined by `service-order-corrections` (the administrator's own password re-typed in the saving request, every changed field audited). That keeps closure from being reversible through a side door: the status keeps reading `Completada` or `Cancelada`, and every rewrite is attributable.

The presence of the control and the acceptance of the write MUST be decided by one shared pure predicate over role and status, so the two cannot drift apart; for a closed status the predicate MUST report "correction required" for `administrador` (control shown as "Corregir") and "refused" for every other role. The UI deciding alone is not sufficient: `PATCH /api/service-orders/[id]` is the trust boundary, and the decision MUST be enforced in the service under a row lock (see `service-order-corrections`), evaluated against the order's status **as read from the database**, never a status supplied in the request body. A refusal MUST answer with a Spanish message and an accurate status code, never a 500.

#### Scenario: Administrador sees the edit control on an open order
- GIVEN an order in `open` status
- WHEN an `administrador` opens its detail page
- THEN the page MUST offer a control that opens the order form in edit mode

#### Scenario: Tecnico sees no edit control on an open order
- GIVEN an order in `open` status
- WHEN a `tecnico` opens its detail page
- THEN the page MUST NOT offer any control that opens the order form in edit mode

#### Scenario: Both roles see the edit control on an in_progress order
- GIVEN an order in `in_progress` status
- WHEN either a `tecnico` or an `administrador` opens its detail page
- THEN the page MUST offer the edit control to both

#### Scenario: Only the administrador is offered a way in on a closed order
- GIVEN an order in `done` or in `cancelled` status
- WHEN an `administrador` opens its detail page THEN the page MUST offer "Corregir" and no plain edit control; WHEN a `tecnico` opens it THEN the page MUST NOT offer any edit or correction control

#### Scenario: The route refuses a patch the UI would not have offered
- GIVEN an order in `open` status
- WHEN a `tecnico` sends `PATCH /api/service-orders/[id]` with `hallazgos`
- THEN the system MUST refuse the patch with a Spanish message, MUST NOT write the field, and MUST NOT answer 500

#### Scenario: The route refuses a closed-order patch without a verified correction
- GIVEN an order in `done` status
- WHEN an `administrador` sends `PATCH /api/service-orders/[id]` with any of the gated fields and no password, or a wrong one
- THEN the system MUST refuse the patch with a Spanish message, MUST NOT write the field, and MUST NOT answer 500

#### Scenario: A tecnico's patch to a closed order is refused
- GIVEN an order in `done` status
- WHEN a `tecnico` sends `PATCH /api/service-orders/[id]` with any gated field, with or without a password
- THEN the system MUST refuse the patch with 403 and MUST NOT write the field

#### Scenario: A verified administrator correction of a closed order saves
- GIVEN an order in `done` status
- WHEN an `administrador` sends `PATCH /api/service-orders/[id]` with a gated field and their correct password
- THEN the system MUST persist the field, MUST leave `status` and `completedAt` unchanged, and MUST audit the change

#### Scenario: The route reads status from the record, not from the body
- GIVEN an order whose stored status is `done`
- WHEN a patch arrives whose body also claims a status of `in_progress`
- THEN the gate MUST be evaluated against the stored `done`: without a verified administrator correction the patch MUST be refused, and with one the stored status MUST remain `done`

#### Scenario: A permitted patch still saves
- GIVEN an order in `in_progress` status
- WHEN a `tecnico` patches `hallazgos` and `recomendaciones`
- THEN the system MUST persist both values

#### Scenario: The edit control meets the hit-target floor
- GIVEN a detail page that offers the edit control
- WHEN it renders
- THEN that control MUST measure at least 44x44
