# Delta for order-work-lines

Copy from `mockup/index.html` (approved 2026-11-06), verbatim. Presentation only: who may write and when (`canWriteFor`, `Who Writes Work Lines and When`) is unchanged. **[browser]** scenarios cannot be verified in jsdom.

## MODIFIED Requirements

### Requirement: Work Line and Mark Interface

The order detail page MUST show a "Líneas de trabajo" card listing each line (technician, description, duration, date), per-technician totals, and an add control wherever the viewer may add. A técnico MUST see a "Mi parte lista" control (and its un-mark counterpart) for their own assignment only. The page MUST show each assigned technician's marked or pending state. The UI MUST work at tablet and phone widths, copy MUST be Spanish, every mutation MUST show a success toast above `router.refresh()` and below the `try/catch`, form errors MUST stay inline, and every action control MUST measure at least 44x44. No secure-context-only browser API MUST be used.

When the card withholds a control because of the order's status or the viewer's own mark, it MUST say why with a hint: `muted-foreground` text, `text-sm`, 16px info icon, no box and no color. The hint is chosen by the status and the viewer's role (`administrador`/`jefe_taller` = "jefe", versus `tecnico`):

| Situation | Viewer | Hint | Button |
|---|---|---|---|
| `open`, no assigned technician | jefe | "Asigná un técnico para poder cargar líneas." | "Asignar técnico" (focuses `#assign-tecnico`), or link "Ir a Técnicos" to `/technicians` when no `#assign-tecnico` renders |
| `booked` | jefe | "Recibí la orden para cargar líneas." | none |
| `booked` | técnico | "El jefe de taller tiene que recibir la orden para cargar líneas." | none |
| `on_hold` | jefe | "La orden está en espera; reanudala para cargar líneas." | none |
| `on_hold` | técnico | "La orden está en espera; el jefe de taller tiene que reanudarla." | none |
| `diagnosing` | técnico (own part unmarked) | "Vas a poder marcar tu parte cuando el jefe de taller pase la orden a En progreso." | none (next to "Agregar línea") |
| `in_progress` or `ready_for_review`, own part marked | técnico | "Desmarcá tu parte lista antes de cambiar líneas de trabajo." | none (next to "Desmarcar mi parte") |

The previously unreachable "Asigná un técnico para poder cargar líneas." condition at `OrderWorkCard.tsx:196` (it required `mode !== "refused"` while `open` is always refused) MUST be replaced by the table above. The hint row sits above the empty-state line "Todavía no hay líneas de trabajo." when there are no lines, which stays. No hint from the table MUST render when the viewer can write and has nothing withheld (an administrador/jefe on `diagnosing`, `in_progress` or `ready_for_review`; a técnico with an unmarked part on `in_progress`), nor on a closed order. The `diagnosing` técnico row is informational: it renders while writing is allowed, because only "Mi parte lista" is withheld. "Mi parte lista" stays available only on `in_progress`, unchanged.
(Previously: no hint explained a missing control, and with `workLineMode` `refused` the card showed only "Todavía no hay líneas de trabajo.".)

#### Scenario: Lines and totals shown
- GIVEN an order with lines from T (30 + 60 min) and U (45 min)
- WHEN staff opens its detail page
- THEN each line and the totals 90 min for T and 45 min for U MUST show

#### Scenario: Técnico sees only their own mark control
- GIVEN an `in_progress` order assigned to T and U
- WHEN T opens the page
- THEN a "Mi parte lista" control for T MUST show and none for U

#### Scenario: Mutation confirms
- GIVEN a successful line add or mark
- WHEN the response arrives
- THEN a Spanish success toast MUST show and the page MUST refresh

#### Scenario: Controls meet the hit-target floor
- GIVEN the card with its add, edit, delete and mark controls
- WHEN it renders
- THEN each MUST measure at least 44x44

#### Scenario: Recibida without técnico, jefe **[unit]**
- GIVEN an `open` order with no assignee, viewed by an administrador, with `#assign-tecnico` on the page
- WHEN the card renders
- THEN "Asigná un técnico para poder cargar líneas." MUST show above "Todavía no hay líneas de trabajo." with an "Asignar técnico" button that focuses `#assign-tecnico`

#### Scenario: Recibida without técnico and nobody left to assign **[unit]**
- GIVEN the same order with no `#assign-tecnico` rendered
- WHEN the card renders
- THEN the button MUST be a link "Ir a Técnicos" to `/technicians`

#### Scenario: Agendada, jefe **[unit]**
- GIVEN a `booked` order with an assignee, viewed by a jefe_taller
- WHEN the card renders
- THEN "Recibí la orden para cargar líneas." MUST show and no button MUST accompany it

#### Scenario: Agendada, técnico **[unit]**
- GIVEN the same order viewed by the assigned técnico
- WHEN the card renders
- THEN "El jefe de taller tiene que recibir la orden para cargar líneas." MUST show and "Recibí la orden para cargar líneas." MUST NOT

#### Scenario: En espera, jefe **[unit]**
- GIVEN an `on_hold` order viewed by an administrador
- WHEN the card renders
- THEN "La orden está en espera; reanudala para cargar líneas." MUST show

#### Scenario: En espera, técnico **[unit]**
- GIVEN the same order viewed by an assigned técnico
- WHEN the card renders
- THEN "La orden está en espera; el jefe de taller tiene que reanudarla." MUST show

#### Scenario: En diagnóstico, técnico **[unit]**
- GIVEN a `diagnosing` order assigned to técnico T (part unmarked)
- WHEN T opens it
- THEN "Agregar línea" MUST show, "Mi parte lista" MUST NOT, and "Vas a poder marcar tu parte cuando el jefe de taller pase la orden a En progreso." MUST show

#### Scenario: En diagnóstico hint is técnico-only **[unit]**
- GIVEN the same order viewed by a jefe_taller
- WHEN the card renders
- THEN that hint MUST NOT show

#### Scenario: Técnico after Mi parte lista **[unit]**
- GIVEN an `in_progress` order where técnico T has marked their part
- WHEN T opens it
- THEN "Desmarcar mi parte" MUST show, "Agregar línea", "Editar" and "Eliminar" MUST NOT, and "Desmarcá tu parte lista antes de cambiar líneas de trabajo." MUST show

#### Scenario: Lista para revisión, técnico **[unit]**
- GIVEN a `ready_for_review` order where técnico T has marked their part
- WHEN T opens it
- THEN "Desmarcá tu parte lista antes de cambiar líneas de trabajo." MUST show, and "La orden está lista para revisión; solo el jefe de taller puede cambiar líneas." MUST NOT exist anywhere (it is false while "Desmarcar mi parte" is offered)

#### Scenario: No hint when the viewer can write **[unit]**
- GIVEN an `in_progress` order and a técnico with an unmarked part, and a jefe on `ready_for_review`
- WHEN each card renders
- THEN none of the hints in the table MUST show

#### Scenario: Copy is exact **[unit]**
- GIVEN every row of the table rendered at least once
- WHEN the texts are read
- THEN each MUST equal the string in the table character for character, accents and voseo included

#### Scenario: Hint layout beside controls **[browser]**
- GIVEN the "Desmarcar mi parte" and "Agregar línea" rows with a hint at 390px and 768px, light and dark
- WHEN rendered
- THEN the hint MUST wrap beside or under the button without overflowing, and the button MUST stay at least 44x44
