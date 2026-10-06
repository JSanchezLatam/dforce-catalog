# Delta for table-sorting

## MODIFIED Requirements

### Requirement: Per-Table Sortable Column Whitelist

Each table MUST expose a fixed whitelist of sortable columns. A column not on
the whitelist MUST NOT render a clickable header. The desktop inventory table
MUST render `price` and `stock` as plain, non-sortable columns.
(Previously: `stock` and `price` were fetched but not rendered as columns.)

| Table | Sortable | Excluded — reason |
|---|---|---|
| Customers | `name`, `phone`, `email` | `plates` (Vehículos) — see the Conditional Vehicles Column requirement |
| Inventory | `id`, `name`, `categoryL1`, `categoryL2` | `stock`, `price` — rendered as plain columns, no sort control |
| Service orders | `id`, `status`, `appointmentAt` | `description` — unindexed free text, no user-meaningful order |
| Users | `username`, `name`, `email`, `role`, `estado` | `Acciones` — not data |

#### Scenario: Non-whitelisted column has no header control

- GIVEN the inventory list view at `md`+
- WHEN staff views the `stock` and `price` columns
- THEN both headers render as plain text, with no clickable sort control. **[unit]**; column visibility at 1280 **[LAN]**
