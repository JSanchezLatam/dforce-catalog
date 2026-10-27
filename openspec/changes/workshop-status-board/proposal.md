# Proposal: Workshop Status Board

## Intent

Replace the physical whiteboard with a live board on fixed big screens (workshop, office) and on each person's own screen. A big screen must never die silently. Evidence: `explore.md`.

## Scope

### In Scope
- `/tablero` full board: administrador, jefe_taller, tecnico. Read-only, zero controls. Shows plate, make/model, internal status (incl. hold reason), assigned technicians, time in status.
- **Scope decision**: the full board shows NO customer name and NO phone, because técnicos normally see only their own orders.
- `/tablero/clientes` waiting-room view: plate (unmasked), make/model, customer-facing status from the exported portal `CUSTOMER_STATUS` map. Hides `booked` and `cancelled`.
- Statuses: backlog (`booked`, `open`, `diagnosing`, `in_progress`, `on_hold`, `ready_for_review`) plus `done` completed today (customer view: same minus `booked`).
- Role `pantalla`: one read-only account for every big screen; sees ONLY `/tablero/clientes`, which is its landing.
- Kiosk resilience: 180-day session TTL for `pantalla` only; client JSON poller keeps the last good snapshot and shows "Sin conexión · actualizado hace N min"; 401 → `/login`.
- Role-aware landing for `/`, login and forced password change (`pantalla` → `/tablero/clientes`, others unchanged `/inventory`).

### Out of Scope
- Agenda (SDD 3), technician hours (SDD 4).
- Any control on either board.
- Kiosk OS setup (wake, auto-start): documented only.

## Capabilities

### New Capabilities
- `workshop-status-board`: both views, access per role, field whitelists, status sets, polling/staleness, `pantalla` session TTL and landing.

### Modified Capabilities
- `user-management`: `pantalla` becomes an assignable role (create/edit/list/filter), with no `users.manage` and no `account.self`.

Note: `role-permissions` and `user-account` have no main baseline (archive only); their rules for `pantalla` live in the new capability.

## Approach

- Enum value via `ALTER TYPE ... ADD VALUE` migration (0028 precedent); actions `board.read`, `board.customer` in the `MATRIX`; `ROUTE_GUARDS` entries.
- Dedicated board queries that never join `cliente` (privacy by construction); field-by-field mapper with a sentinel-poison test, copied from `portal-sync/snapshot.ts`.
- Top-level `src/app/tablero/**`, chrome-less layout, server first paint + guarded GET poll routes.
- Time in status from `orden_estado_historial`, falling back to `updated_at` for pre-0033 orders.
- Chained PRs ≤400 lines off tracker `feat/workshop-status-board`: WU1 role/landing/TTL, WU2 data layer, WU3 customer view + poller, WU4 full board + nav + TV styling.

## Affected Areas

| Area | Impact |
|------|--------|
| `src/shared/db/schema.ts`, `drizzle/` | Modified: enum + migration |
| `src/modules/auth/{roles,policy,edit-policy,actions,session}.ts`, `src/app/page.tsx` | Modified |
| `src/modules/portal-sync/snapshot.ts` | Modified: export map |
| `src/modules/board/**`, `src/app/tablero/**` | New |
| `src/modules/layout/nav-items.ts` | Modified: nav link |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Customer data leaks to a screen | Med | No `cliente` join; sentinel test |
| TV on full board uses a jefe/admin account | Med | Documented physical-access risk |
| DB error renders a dead 500 page | Med | Poller keeps last snapshot; LAN-IP browser check |
| TV legibility untestable in jsdom | High | Browser check on a real screen |

## Rollback Plan

Revert the chain's PRs. The enum value stays (Postgres cannot drop it); deactivate `pantalla` users, which revokes their sessions.

## Dependencies

- `service-order-workflow-states` (merged): statuses, hold reason, history table.

## Success Criteria

- [ ] A `pantalla` TV stays live for days and shows staleness on network loss.
- [ ] No customer name/phone on either view (sentinel test green).
- [ ] Técnico sees the full board, no controls; `pantalla` gets 403 on `/tablero`.
- [ ] Verified at the LAN IP, not localhost.

## Proposal question round

Decisions are final; one open copy question (non-blocking): is "Terminada" right for `done` on the waiting-room screen?
