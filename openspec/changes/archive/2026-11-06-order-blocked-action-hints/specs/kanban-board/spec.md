# Delta for kanban-board

Copy from `mockup/index.html` (approved 2026-11-06), verbatim. Presentation only. **[browser]** scenarios cannot be verified in jsdom.

## MODIFIED Requirements

### Requirement: Move Rules

A move MUST be planned by one pure function used by drag, menu and phone sheet alike. A target is legal only if it is in `getManualTransitions(card.status)` and differs from the current column. `diagnosing` and `ready_for_review` MUST never be a manual target; `done` and `open` offer no onward move from the board beyond what `getManualTransitions` allows. During a drag, legal columns MUST light up with their own color and every other column except the origin MUST be dimmed with a hint that depends on BOTH the origin status and the target column: when the target is in the transition table for the origin AND is automatic, the hint is "Pasa sola al asignar un técnico" (target `diagnosing`) or "Pasa sola cuando todos marcan su parte lista" (target `ready_for_review`); otherwise it is "Desde <estado origen> no se puede pasar a <estado destino>" using the Spanish status labels. The hint is rendered by one pure function shared by the dimmed column and the drop toast. Dropping on an illegal column MUST send no request and MUST show an info toast with the same text as that column's hint followed by a period. Dropping on the origin column MUST do nothing and show no toast. "Mover a…" MUST list only legal targets and be absent when none exist. A move to "En espera" MUST ask the reason with two options, "Repuesto" ("Falta que llegue una pieza") and "Aprobación del cliente" ("El cliente tiene que aprobar el trabajo"), under the title "¿Por qué queda en espera?", and the confirm button "Pasar a En espera" MUST stay disabled until one is chosen. A move to "Completada" MUST ask "¿Marcar la orden como Completada?" (confirm "Sí, completar", dismiss "Cancelar"). A move from "Lista para revisión" to "En progreso" MUST ask for confirmation before calling the server. "Cancelar orden" MUST exist only in the card menu, MUST ask for confirmation, and MUST never be a drop target.
(Previously: every dimmed column read "No se puede mover acá" regardless of origin, and dropping on an illegal column did nothing silently.)

#### Scenario: Legal and illegal targets
- GIVEN an `in_progress` card
- WHEN a drag starts
- THEN "En espera" and "Completada" MUST be highlighted **[unit]**
- AND "En diagnóstico" MUST be dimmed with "Desde En progreso no se puede pasar a En diagnóstico" **[unit]**
- AND "Lista para revisión" MUST be dimmed with "Pasa sola cuando todos marcan su parte lista" **[unit]**

#### Scenario: Recibida dragged over En diagnóstico **[unit]**
- GIVEN an `open` card
- WHEN a drag starts
- THEN "En diagnóstico" MUST be dimmed with "Pasa sola al asignar un técnico" and "En progreso" with "Desde Recibida no se puede pasar a En progreso"

#### Scenario: Same target, different origin **[unit]**
- GIVEN a `booked` card
- WHEN a drag starts
- THEN "En diagnóstico" MUST be dimmed with "Desde Agendada no se puede pasar a En diagnóstico", not "Pasa sola al asignar un técnico"

#### Scenario: Automatic review target from another origin **[unit]**
- GIVEN a `diagnosing` card
- WHEN a drag starts
- THEN "Lista para revisión" MUST be dimmed with "Desde En diagnóstico no se puede pasar a Lista para revisión"

#### Scenario: Illegal drop explains itself **[unit]**
- GIVEN an `open` card being dragged
- WHEN it is dropped on "En diagnóstico"
- THEN no request MUST be sent, the card MUST stay, and an info toast "Pasa sola al asignar un técnico." MUST show

#### Scenario: Illegal drop from another origin **[unit]**
- GIVEN a `booked` card dropped on "En diagnóstico"
- WHEN the drop lands
- THEN no request MUST be sent and the toast "Desde Agendada no se puede pasar a En diagnóstico." MUST show

#### Scenario: Drop on own column is silent **[unit]**
- GIVEN any card dropped on its own column
- WHEN the drop lands
- THEN no request and no toast MUST result

#### Scenario: The old generic text is gone **[unit]**
- GIVEN any drag
- WHEN dimmed columns render
- THEN no element MUST read "No se puede mover acá"

#### Scenario: Hold needs a reason
- GIVEN a drop on "En espera"
- WHEN the dialog opens
- THEN "Pasar a En espera" MUST be disabled until a reason is picked, and the PATCH MUST carry that reason **[unit]**

#### Scenario: Complete is confirmed
- GIVEN a drop on "Completada"
- WHEN the operator dismisses with "Cancelar"
- THEN no request MUST be sent and the card MUST stay **[unit]**

#### Scenario: Recibida refused when incomplete
- GIVEN a `booked` card whose `missing` is non-empty
- WHEN the operator moves it to "Recibida"
- THEN no request MUST be sent, and a dialog titled "Todavía no se puede recibir" MUST read "Completá el vehículo y la categoría antes de recibir la orden", list "Vehículo" and "Categoría" as "sin cargar" as applicable, and offer "Cerrar" and "Editar orden" (a link to the order) **[unit]**

#### Scenario: Drop hint placement and legibility **[browser]**
- GIVEN a drag in progress at 1280px and 768px
- WHEN the dimmed columns render
- THEN each hint MUST be fully readable inside its column (not clipped, text wrapping within the column width) and the dimmed card content MUST stay dimmed

### Requirement: Card Menu and Urgent Toggle

Every card MUST have a 44x44 button "Acciones de la orden" opening a menu: "Mover a…" (submenu "Mover <placa> a…"), "Marcar como urgente" or "Quitar urgente" (administrador and jefe_taller only), "Ver orden", and "Cancelar orden" (danger style, gated like moves). Marking MUST toast "Orden marcada como urgente"; clearing MUST toast "Orden desmarcada como urgente". The menu MUST be reachable by keyboard and screen reader. When the card is `open` (so "Mover a…" is absent because `legalTargets("open")` is empty) and the viewer may move cards (administrador, jefe_taller), the menu MUST begin with a disabled, `aria-disabled` item with an info icon reading "Para pasarla a En diagnóstico, asigná un técnico.", followed by a separator; the phone sheet (`MoveSheet`) MUST show the same text as a non-actionable row first, and keep its `Trash2` on "Cancelar orden". The item MUST NOT be focus-activatable and MUST NOT appear for any other status or for a técnico.
(Previously: an `open` card's menu silently lacked "Mover a…".)

#### Scenario: Toggle by role
- GIVEN an urgent card
- WHEN a jefe_taller opens its menu, then a técnico does
- THEN the jefe MUST see "Quitar urgente" and the técnico MUST see only "Ver orden" **[unit]**

#### Scenario: Mark urgent
- GIVEN a non-urgent card
- WHEN a jefe chooses "Marcar como urgente" and the server accepts
- THEN the card MUST show the "Urgente" badge, sort first, and the toast MUST show **[unit]**

#### Scenario: Recibida menu explains the missing move **[unit]**
- GIVEN an `open` card and a jefe_taller
- WHEN the menu opens
- THEN its first item MUST be disabled and read "Para pasarla a En diagnóstico, asigná un técnico.", "Mover a…" MUST be absent, and "Marcar como urgente", "Ver orden" and "Cancelar orden" MUST remain

#### Scenario: Disabled item does nothing **[unit]**
- GIVEN that menu
- WHEN the operator activates the disabled item
- THEN no request MUST be sent and the menu MUST stay open

#### Scenario: Phone sheet carries the same reason **[unit]**
- GIVEN an `open` card on a phone viewport and an administrador
- WHEN the sheet opens
- THEN its first row MUST read "Para pasarla a En diagnóstico, asigná un técnico." and "Cancelar orden" MUST still be offered

#### Scenario: Other statuses and roles get no reason item **[unit]**
- GIVEN a `booked` card for a jefe, and an `open` card for a técnico
- WHEN each menu opens
- THEN neither MUST contain "Para pasarla a En diagnóstico, asigná un técnico."

#### Scenario: Blocked row hit target and wrap **[browser]**
- GIVEN the Recibida menu and the sheet at tablet and phone widths, light and dark
- WHEN rendered
- THEN the text MUST wrap inside the menu (max 280px) without clipping, and the row MUST measure at least 44px tall
