# Proposal: Kanban Board

## Intent

The jefe de taller moves orders through statuses one detail page at a time, and nothing on screen says which ones matter most right now. A drag-and-drop kanban at `/kanban` (Taller group) gives administrador and jefe_taller one place to see and move the whole floor, plus a manual "Urgente" flag. Técnico reads it; pantalla never sees it. The TV boards adopt the same look. Visual contract: `mockup/index.html`, approved 2026-10-27.

## Scope

### In Scope
- Manual "Urgente" flag: nullable `urgente_at` + `urgente_by` on `orden_servicio`, a toggle gated by `service-orders.assign`, success toast, e2e.
- `/api/kanban` + `kanban/shape.ts` (the only mapper that emits `id`, `missing`, `mine`, `urgent`); KPIs; filters (Todas, Mis órdenes, Urgentes, En espera).
- The page: column per status (no Cancelada), horizontal scroll with ‹ ›, urgent-first sort, red reserved for Urgente, amber only for concrete reasons.
- Card menu ⋯ (Mover a…, Marcar/Quitar urgente, Ver orden, Cancelar orden), En espera reason dialog, confirmations, optimistic PATCH with rollback, toasts; on phone, a bottom sheet instead of drag.
- `@dnd-kit/core` drag on desktop/tablet (long-press ~200 ms on touch).
- New board tokens in `globals.css`; TV restyle of `/tablero` and `/tablero/clientes` with shared primitives; `/tablero` shows the Urgente badge.

### Out of Scope
- Toggling Urgente from the order detail page (not mocked).
- An urgent-flag history trail (only the latest who/when is stored).
- Generalizing the server `stale_status` copy.
- Time-based urgency, per-column targets, and average wait.

## Capabilities

### New Capabilities
- `kanban-board`: view, access, card fields, KPIs, filters, move rules, menu, drag, phone sheet, nav entry.

### Modified Capabilities
- `service-orders`: urgent flag requirement (columns, permission, toggle, toast copy).
- `workshop-status-board`: full-board whitelist gains `urgent`; urgent-first ordering; restyle keeps every pinned structure.

## Approach

Follows explore.md: reuse `workshopBoardData`, and drop legality comes from `getManualTransitions`. The pure `planMove` holds every rule, so drag and menu share one tested path. The existing PATCH carries `expectedStatus`. The new mapper keeps `id` away from the TV whitelist.

## Work Units (chained, ≤400 lines each)

| WU | Content | Est. |
|---|---|---|
| 1 | Urgent migration, service, route, e2e | ~300 |
| 2 | Kanban query/shape/KPIs, `mine`, `/api/kanban`, guards, nav, TV `urgent` | ~350 |
| 3 | Tokens, shared primitives, read-only board page, filters, phone tabs | ~400 |
| 4 | `planMove`, menu, dialogs, optimistic PATCH, toasts | ~400 |
| 5 | Urgent toggle in the menu, phone bottom sheet | ~250 |
| 6 | dnd-kit drag | ~250 |
| 7 | TV restyle of both boards | ~350 |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| dnd-kit portal/ids cause hydration mismatch | Med | Browser check at the LAN IP |
| `id`/`missing` reach TV payload | Low | Key-equality and no-id tests |
| New SQL is unverified by the unit suite | High | e2e rows |
| Poll overwrites an optimistic move | Med | Fake-timer test |

## Rollback Plan

Revert the chain by WU, in reverse order. The migration only adds nullable columns, so reverting the code leaves them unused. The TV restyle (WU7) reverts on its own.

## Success Criteria

- [ ] Jefe and admin move and flag cards, and every mutation shows a toast. A stale move rolls back with its message.
- [ ] Técnico has no move or flag control. Pantalla gets 403 or PermissionDenied.
- [ ] Verified in a browser at the LAN IP on desktop, tablet and phone, light and dark.

## Proposal question round (resolved by the orchestrator 2026-10-27, under the owner's autonomous-delivery rule; the mockup is the contract)

1. Leaving the board (done, cancelled) does not clear Urgente.
2. Kanban move toast reads "Orden movida a <estado>" as mocked, not "Orden pasada a…". Board errors go in a toast.
3. `/tablero` shows Urgente but not "falta categoría".
