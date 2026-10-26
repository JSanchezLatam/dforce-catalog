# Delta Spec: table-bulk-actions

The service-orders status column keeps rendering through `StatusBadge`, which now covers all eight statuses. Tag **[unit]** = markup; **[LAN]** = browser check at the LAN IP.

## MODIFIED Requirements

### Requirement: Enum Column Badges

Where a table column already renders a small, fixed-cardinality state as
inline text or an ad-hoc span, the column MUST render using
`components/ui/badge.tsx` instead — the customers list's "Desactivado" marker
and the users table's "Activo"/"Inactivo" column. This MUST NOT apply to
service-orders' status column, which keeps rendering through `StatusBadge`,
or to any inventory column (no enum column exists there). `StatusBadge` MUST
render every order status — "Agendada", "Recibida", "En diagnóstico",
"En progreso", "En espera", "Lista para revisión", "Completada", "Cancelada" —
as a visually distinct badge, in the table and in the phone card's status chip.
The shared badge's own reminder state `scheduled` MUST NOT be reused for
`booked`; the two are different values.
(Previously: the service-orders status column was "unchanged, out of scope" and the badge knew five order statuses.)

#### Scenario: Customer deactivated marker becomes a badge
- GIVEN a deactivated customer in the list
- WHEN the row renders
- THEN "Desactivado" MUST render as a `Badge`, not the current ad-hoc span

#### Scenario: Service-orders status keeps StatusBadge
- GIVEN the service-orders list
- WHEN it renders
- THEN its status column MUST render through `StatusBadge`, not the generic `Badge` **[unit]**

#### Scenario: Every order status has a label **[unit]**
- GIVEN one row per order status
- WHEN the table and the phone cards render
- THEN each row MUST show its Spanish label from the list above, and the eight badges MUST be pairwise distinguishable

#### Scenario: A booked order is not shown as a reminder state **[unit]**
- GIVEN an order in `booked`
- WHEN its badge renders
- THEN it MUST read "Agendada" and MUST NOT share the reminder `scheduled` rendering path's label
