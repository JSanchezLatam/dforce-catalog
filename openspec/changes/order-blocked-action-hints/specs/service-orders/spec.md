# Delta for service-orders

Source of truth for copy and layout: `mockup/index.html` (approved 2026-11-06). Spanish strings below are verbatim. Presentation only: no transition, permission or SQL change. Scenarios tagged **[browser]** cannot be verified by jsdom (it matches no media query and measures no layout); they are verified in a real browser at the LAN IP, light and dark.

## MODIFIED Requirements

### Requirement: Status Labels, Badge and List Filter

Every status MUST render with its Spanish label (list above) through `StatusBadge` on the list, the cards, and the detail page, each visually distinguishable; `open` MUST read "Recibida", never "Abierta". The `/service-orders` status filter MUST offer all eight statuses, `cancelled` included. A `status` URL parameter outside the eight MUST be ignored. Sorting by status MUST order `booked`, `open`, `diagnosing`, `in_progress`, `on_hold`, `ready_for_review`, `done`, `cancelled` ascending. The detail page for an `on_hold` order MUST show the badge with its reason. The order-status colors of `StatusBadge` MUST follow `STATUS_HUE` (`board/primitives.tsx`) so the badge, the board column and the status action button of one status share one hue: light theme background `hsl(H S 92%)` and text `hsl(H S 28%)`; dark theme background `hsl(H S*0.5 18%)` and text `hsl(H S 78%)`. `cancelled` is not in `STATUS_HUE` and MUST keep its current treatment. Badge icons MUST NOT change. Non-order uses of `StatusBadge` MUST NOT change color.
(Previously: the badge used its own tone map, so "En progreso", "En espera" and "Lista para revisión" were all amber, "Recibida" gray and "En diagnóstico" sky; no color contract existed.)

#### Scenario: Each label renders **[unit]**
- GIVEN one order in each of the eight statuses
- WHEN the list renders
- THEN the badges MUST read "Agendada", "Recibida", "En diagnóstico", "En progreso", "En espera", "Lista para revisión", "Completada", "Cancelada" and none MUST read "Abierta"

#### Scenario: Filter by each new status **[e2e]**
- GIVEN one order in each status
- WHEN staff filters by `diagnosing`, `on_hold`, `booked` and `cancelled` in turn
- THEN each filter MUST return exactly that order and count 1

#### Scenario: Unknown status parameter ignored
- GIVEN `?status=garbage`
- WHEN the list renders
- THEN it MUST behave as unfiltered and not error

#### Scenario: Sort order **[e2e]**
- GIVEN one order in each status, sorted by status ascending
- WHEN the list renders
- THEN the order MUST be the lifecycle sequence stated above

#### Scenario: Badge hue equals STATUS_HUE **[unit]**
- GIVEN each of the seven statuses present in `STATUS_HUE`
- WHEN `StatusBadge` renders it
- THEN its color classes/style MUST derive from that status's `STATUS_HUE` hue and saturation (not from the previous amber/gray/sky tones), and "En progreso" and "En espera" MUST NOT share a color

#### Scenario: Cancelled keeps its own style **[unit]**
- GIVEN a `cancelled` order
- WHEN `StatusBadge` renders it
- THEN it MUST render exactly the treatment it had before this change

#### Scenario: Badge text contrast **[browser]**
- GIVEN each order-status badge, in light and dark theme
- WHEN measured in the browser
- THEN its text MUST reach at least 4.5:1 against its own background, "Completada" in light theme included

## ADDED Requirements

### Requirement: Order Detail Action Bar

On the order detail, "Editar orden" and "Imprimir" MUST sit on the breadcrumb line, right-aligned, each with a lucide icon (`Pencil`, `Printer`), and MUST keep their current visibility rules. The card title row MUST hold only the title and the status badge. The status controls (administrador and jefe_taller only, as today) MUST render on their own row under the title.

Each status button MUST carry a lucide icon and the color of the status it leads to, from `STATUS_HUE`: tint (light `hsl(H S 92%)` / text `hsl(H S 28%)`; dark `hsl(H S*0.5 18%)` / text `hsl(H S 78%)`), except the normal next step, which MUST be filled (light `hsl(H S 32%)` with white text; dark `hsl(H S 78%)` with the page background as text). Only the normal next step MUST be filled: "Recibir" on `booked`, "Pasar a En progreso" on `diagnosing`, "Reanudar" on `on_hold`, "Completar" on `ready_for_review`. On `open` and `in_progress` no button is filled (the normal next step is automatic, and "Completar" skips review).

Labels, icons and aria-labels (the visible label is short; where it differs from the long action name, the full text MUST be the `aria-label`):

| Button (visible) | Icon | Leads to | aria-label |
|---|---|---|---|
| "Recibir" | `Inbox` | `open` | (same as visible) |
| "Pasar a En progreso" | `Wrench` | `in_progress` | "Marcar como En progreso" |
| "En espera · repuesto" | `Pause` | `on_hold` | "Marcar como En espera (repuesto)" |
| "En espera · aprobación" | `Pause` | `on_hold` | "Marcar como En espera (aprobación del cliente)" |
| "Completar" | `Check` | `done` | "Marcar como Completada" |
| "Reanudar" | `Wrench` | `in_progress` | (same as visible) |
| "Volver a En progreso" | `Wrench` | `in_progress` | "Marcar como En progreso" |
| "Cancelar" | `Ban` | `cancelled` | "Marcar como Cancelada" |

"Cancelar" MUST always be last, after a visual divider that is `aria-hidden`, and MUST keep the `destructive` button variant unchanged. Statuses present per order status MUST NOT change (same `getManualTransitions` set): `booked`: Recibir, Cancelar; `open`: Cancelar; `diagnosing`: Pasar a En progreso, Cancelar; `in_progress`: both En espera, Completar, Cancelar; `on_hold`: Reanudar, Cancelar; `ready_for_review`: Completar, Volver a En progreso, Cancelar. Below 640px (container width) the status controls MUST stack in one column at full width, divider horizontal. The status row MUST NOT be clipped by the card at 1280px with the sidebar open. Every control MUST keep a 44x44 minimum hit target.

#### Scenario: Secondary actions move to the breadcrumb line **[unit]**
- GIVEN an administrador on any order's detail
- WHEN the page renders
- THEN "Editar orden" and "Imprimir" MUST be in the breadcrumb row and MUST NOT be inside the card header's status controls

#### Scenario: Short label, full accessible name **[unit]**
- GIVEN an `in_progress` order
- WHEN the status bar renders
- THEN `getByRole("button", { name: "Marcar como En espera (aprobación del cliente)" })` MUST resolve to the button whose visible text is "En espera · aprobación"
- AND `getByRole("button", { name: "Marcar como Completada" })` MUST resolve to the button reading "Completar"
- AND `getByRole("button", { name: "Marcar como Cancelada" })` MUST resolve to the button reading "Cancelar"

#### Scenario: Only the normal next step is filled **[unit]**
- GIVEN orders in `booked`, `diagnosing`, `on_hold`, `ready_for_review`, `open` and `in_progress`
- WHEN each status bar renders
- THEN exactly one button MUST be filled on the first four (Recibir, Pasar a En progreso, Reanudar, Completar respectively) and none on `open` and `in_progress`
- AND on `ready_for_review` "Volver a En progreso" MUST be tinted, not filled

#### Scenario: Button color is the target status hue **[unit]**
- GIVEN the status buttons of an `in_progress` order
- WHEN they render
- THEN both "En espera" buttons MUST use the `on_hold` hue (220 14%), "Completar" the `done` hue (142 55%), and on a `ready_for_review` order "Volver a En progreso" the `in_progress` hue (290 50%)

#### Scenario: Cancelar is last after a divider **[unit]**
- GIVEN any order with more than one status button
- WHEN the status bar renders
- THEN "Cancelar" MUST be the last control, immediately preceded by an `aria-hidden` divider, and carry the destructive variant

#### Scenario: Icons per button **[unit]**
- GIVEN an `in_progress` order
- WHEN the status bar renders
- THEN each button MUST contain an `svg` icon and "Cancelar" MUST use the `Ban` icon

#### Scenario: Statuses offered are unchanged **[unit]**
- GIVEN each non-terminal order status
- WHEN the status bar renders
- THEN the set of buttons MUST match the table above and no button MUST appear that `getManualTransitions` does not allow

#### Scenario: Técnico has no status controls **[unit]**
- GIVEN a técnico opening an assigned order
- WHEN the page renders
- THEN no status button MUST render

#### Scenario: Header never clips **[browser]**
- GIVEN an `in_progress` order with the sidebar open at 1280px
- WHEN the page renders
- THEN all four status buttons MUST be fully visible, none cut by the card

#### Scenario: Phone stacks full width **[browser]**
- GIVEN the same order at 390px
- WHEN the page renders
- THEN the status buttons MUST stack in one column, each full width, with a horizontal divider before "Cancelar"

#### Scenario: Hit target and text contrast **[browser]**
- GIVEN each status button on a tablet viewport, light and dark theme
- WHEN measured
- THEN each MUST measure at least 44x44 and its text MUST reach 4.5:1 against its background, including the filled "Completar" and the tinted "Completar" from `in_progress`

### Requirement: Blocked-Action Hints on Order Detail

Where a status action is missing or disabled because of data state, the detail page MUST say what is missing, in a hint inside the status row: `muted-foreground` text, `text-sm`, with a 16px info icon, no box and no color. The hint is shown only to the roles that see the status controls (administrador, jefe_taller). When the fix is reachable from the page, the hint carries a button.

1. **Recibida without técnico.** An `open` order with no assigned technician MUST show "Para pasarla a En diagnóstico, asigná un técnico." with a button "Asignar técnico" that scrolls to and focuses the `#assign-tecnico` select. When no `#assign-tecnico` is rendered (no active technician left to assign), the button MUST instead be a link "Ir a Técnicos" to `/technicians`.
2. **En progreso with unmarked technicians.** An `in_progress` order MUST show "Pasa a Lista para revisión cuando todos los técnicos marcan «Mi parte lista». Faltan: {names}." where `{names}` lists, comma-separated, only ACTIVE assigned technicians who have not marked "Mi parte lista"; a deactivated technician MUST NOT be listed. The list derives from the data the Líneas de trabajo card already loads. When no active assigned technician is unmarked the hint MUST NOT render.
3. **Agendada missing vehicle or category.** A `booked` order with no `vehiculoId` or an empty `categoria` MUST render "Recibir" disabled and show "Completá el vehículo y la categoría antes de recibir la orden." with an "Editar orden" button that opens the same edit dialog as the breadcrumb one. "Cancelar" MUST stay enabled. The server rule (400 on receive) is unchanged.

#### Scenario: Open order without técnico **[unit]**
- GIVEN an `open` order with no assignee, an active unassigned technician exists, viewed by an administrador
- WHEN the status bar renders
- THEN "Cancelar" MUST be the only status button, the text "Para pasarla a En diagnóstico, asigná un técnico." MUST show, and a button "Asignar técnico" MUST be present

#### Scenario: Asignar técnico focuses the select **[unit]**
- GIVEN the hint above and the assignment card rendered
- WHEN the operator activates "Asignar técnico"
- THEN `#assign-tecnico` MUST receive focus

#### Scenario: No technician left to assign **[unit]**
- GIVEN an `open` order with no assignee and no `#assign-tecnico` on the page ("Todos los técnicos activos ya están asignados.")
- WHEN the status bar renders
- THEN the hint MUST offer a link "Ir a Técnicos" to `/technicians` and MUST NOT offer "Asignar técnico"

#### Scenario: Open order hint for jefe_taller **[unit]**
- GIVEN the same `open` order viewed by a jefe_taller
- WHEN the page renders
- THEN the same hint and button MUST show

#### Scenario: Open order with a technician shows no assign hint **[unit]**
- GIVEN an order whose status is not `open`, or that has an assignee
- WHEN the status bar renders
- THEN "Para pasarla a En diagnóstico, asigná un técnico." MUST NOT show

#### Scenario: Faltan lists only unmarked active technicians **[unit]**
- GIVEN an `in_progress` order assigned to Carlos Pérez (marked), Luis Ríos (unmarked) and Ana Gómez (unmarked)
- WHEN an administrador opens it
- THEN the hint MUST read "Pasa a Lista para revisión cuando todos los técnicos marcan «Mi parte lista». Faltan: Luis Ríos, Ana Gómez."

#### Scenario: Faltan excludes a deactivated technician **[unit]**
- GIVEN an `in_progress` order assigned to Luis Ríos (unmarked, active) and Ana Gómez (unmarked, deactivated)
- WHEN the hint renders
- THEN it MUST end "Faltan: Luis Ríos." and MUST NOT contain "Ana Gómez"

#### Scenario: No unmarked active technician, no Faltan hint **[unit]**
- GIVEN an `in_progress` order whose only unmarked assignee is deactivated
- WHEN the status bar renders
- THEN the "Pasa a Lista para revisión…" hint MUST NOT render

#### Scenario: Faltan hint only on En progreso **[unit]**
- GIVEN orders in `diagnosing`, `on_hold` and `ready_for_review`
- WHEN each status bar renders
- THEN none MUST show "Faltan:"

#### Scenario: Agendada without vehicle **[unit]**
- GIVEN a `booked` order with no vehicle (or no category)
- WHEN an administrador opens it
- THEN "Recibir" MUST be disabled, "Cancelar" enabled, "Completá el vehículo y la categoría antes de recibir la orden." MUST show, and an "Editar orden" button MUST be present in the hint

#### Scenario: Agendada complete enables Recibir **[unit]**
- GIVEN a `booked` order with vehicle and category
- WHEN the status bar renders
- THEN "Recibir" MUST be enabled and the hint MUST NOT show

#### Scenario: Hint visual treatment **[browser]**
- GIVEN any of the hints above in light and dark theme
- WHEN rendered
- THEN it MUST be muted text with a 16px info icon, no box, no amber, and MUST NOT overflow its row at 390px

### Requirement: Empty Order List for a Técnico

When a `tecnico` opens `/service-orders` with no search and no status filter and the list is empty, the empty state MUST keep the heading "No se encontraron órdenes" and replace the body with a reason:
- the técnico's user is linked to a roster row (`findTecnicoByUserId` returns one) but has no assigned orders: "No tenés órdenes asignadas.";
- no roster row is linked to the user: "Tu usuario no está vinculado a un técnico. Pedile al administrador que lo vincule en Técnicos."

No button MUST be offered. With a search or filter active the text MUST stay "Ninguna orden coincide con el filtro." with its "Limpiar filtro" action. For every other role the empty text "Todavía no hay órdenes de servicio registradas." MUST be unchanged. A técnico with at least one visible order MUST see the list as before.

#### Scenario: Linked técnico, nothing assigned **[unit]**
- GIVEN a técnico linked to a roster row with no assigned orders and no filter
- WHEN `/service-orders` renders
- THEN it MUST show "No se encontraron órdenes" and "No tenés órdenes asignadas." and MUST NOT show "Todavía no hay órdenes de servicio registradas."

#### Scenario: Unlinked técnico **[unit]**
- GIVEN a técnico user with no roster row
- WHEN `/service-orders` renders
- THEN it MUST show "Tu usuario no está vinculado a un técnico. Pedile al administrador que lo vincule en Técnicos."

#### Scenario: Filter active keeps the filter message **[unit]**
- GIVEN either técnico above with a status filter or search applied
- WHEN the list is empty
- THEN it MUST show "Ninguna orden coincide con el filtro." and "Limpiar filtro"

#### Scenario: Other roles unchanged **[unit]**
- GIVEN an administrador and no orders at all
- WHEN `/service-orders` renders
- THEN it MUST show "Todavía no hay órdenes de servicio registradas."

#### Scenario: Técnico with orders unchanged **[unit]**
- GIVEN a linked técnico with one assigned order
- WHEN the list renders
- THEN the order MUST show and no reason text MUST render
