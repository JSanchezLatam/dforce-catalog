# Proposal: Order Blocked-Action Hints

## Intent

At the workshop the owner was stuck on a `Recibida` order with no technician: the status bar offered only Cancelar and nothing explained why (`diagnosing` is an automatic target written on technician assignment, `transitions.ts:45`). Wherever an action is missing because of data state, the UI must say what is missing and, where possible, offer the fix. The detail action bar also overflows and is clipped by `Card`'s `overflow-hidden`.

Source of truth for copy and layout: the approved mockup `mockup/index.html` (owner approved 2026-11-06).

## Scope

### In Scope
- **A. Hints (mockup 1-8)**: open order without técnico (detail hint + "Asignar técnico" focusing `#assign-tecnico`, "Ir a Técnicos" variant; disabled item in CardMenu/MoveSheet); kanban drop hint by origin+target plus info toast on illegal drop; "Faltan: {names}" of ACTIVE unmarked assignees on En progreso; técnico hint on En diagnóstico; work-lines refused-by-status hints with role variants (fix the unreachable `OrderWorkCard.tsx:196` condition); técnico hint after Mi parte lista; Agendada missing vehicle/category: Recibir disabled + hint + Editar orden; técnico empty state on `/service-orders` (assigned-none and unlinked-user via `findTecnicoByUserId`).
- **B. Action bar (mockup 9)**: Editar orden/Imprimir move to the breadcrumb line; status buttons get lucide icon and target-status `STATUS_HUE` color, only the normal next step filled, short label with full text in `aria-label`, Cancelar last after a divider (destructive), phone full-width stack; header overflow fixed.
- **C. Badge unification**: `StatusBadge` order-status colors follow `STATUS_HUE`; light text at 28% lightness (AA for done). `cancelled` keeps its current treatment (not in `STATUS_HUE`).

### Out of Scope (follow-ups)
- English server messages in UI (`inventory-sync/job.ts:25`, `pdf-generation/enqueue.ts:88`).
- Removing HSTS (`next.config.ts:69`).
- Remaining inventory items (agenda non-booked, bulk status explanation, vehicle-with-orders delete, portal code, race/stale messages, empty-roster assign copy, users tú→voseo, info-toast contrast).
- Standard labor hours. Bulk status labels unchanged.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `service-orders`: detail hints (1, 3, 7), action bar layout/colors, badge colors (Status Labels, Badge), técnico empty state (8).
- `kanban-board`: Move Rules (origin-dependent drop hint, illegal-drop toast), Card Menu (disabled reason item).
- `order-work-lines`: Work Line and Mark Interface (hints 4, 5, 6 with role variants).

`technicians` is not modified: section 8 only reads `findTecnicoByUserId`.

## Approach

Presentation-only: no transition, permission or SQL changes. One pure `blockedReason`-style helper per surface, derived from `transitions.ts` and data already loaded; hint = `muted-foreground` text + 16px info icon (mockup pattern). Button tint reuses `.board-hue-tile` with a 28% text variant.

## Affected Areas

| Area | Impact |
|------|--------|
| `src/modules/service-orders/OrderStatusControls.tsx`, `src/app/(app)/service-orders/[id]/page.tsx` | Modified |
| `src/modules/service-orders/OrderWorkCard.tsx` | Modified |
| `src/modules/kanban/{CardMenu,MoveSheet,DndBoard}.tsx` | Modified |
| `src/app/(app)/service-orders/page.tsx` | Modified |
| `src/shared/ui/StatusBadge.tsx`, `src/app/globals.css` | Modified |

## Size and Work Units (~1600 lines incl. tests, chained PRs)

| WU | Content | Est. |
|----|---------|------|
| 1 | Badge unification (C) | ~150 |
| 2 | Action bar (B) | ~350 |
| 3 | Detail hints 1, 3, 7 | ~350 |
| 4 | Work-card hints 4, 5, 6 | ~300 |
| 5 | Kanban 1 menu/sheet + 2 drop/toast | ~300 |
| 6 | List empty state 8 | ~150 |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Badge recolor app-wide changes 20 call sites' look | Med | Order statuses only; browser contrast check light/dark |
| Short labels break `getByRole` tests | Low | Full text kept in `aria-label` |
| "Faltan" counts inactive técnicos | Med | Spec scenario + test on ACTIVE filter |
| No test sees rendered height/overflow | High | Browser check at LAN IP, tablet/phone |

## Rollback Plan

Each WU is an independent revert of its PR; no data or migration involved.

## Dependencies

None.

## Success Criteria

- [ ] Every mockup 1-8 situation shows its hint; open order without técnico explains the path.
- [ ] Action bar never clips at 1280 with sidebar; phone stacks full width.
- [ ] Badge, board column and button share one hue per status; all button text ≥4.5:1.

## Proposal question round (assumptions for owner review)

1. 5b/5c técnico variants use the mockup's flagged copy ("El jefe de taller tiene que recibir/reanudar…").
2. 5d (Lista para revisión, técnico) uses section 6 text, since "solo el jefe" is false while Desmarcar exists.
3. Section 7 keeps the in-row "Editar orden" button.
4. Badges keep their current icons; only colors change.
5. Cancelar uses `Ban` on the detail; `MoveSheet` keeps `Trash2`.
