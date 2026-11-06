# Design: Order Blocked-Action Hints

## Technical Approach

The change touches presentation only. Every hint string comes from one DB-free module, `service-orders/hints.ts`, which reads `transitions.ts` and data the pages already load. Components only render what it returns. Colour has one source: today's `STATUS_HUE` numbers move to `shared/ui/status-hue.ts`, so the badge, the status buttons, the board columns and the backlog dots all read the same values. Two CSS recipes (`hue-tint` and `hue-fill`) live beside `.board-hue-*`. The palette tokens do not change. The visual contract is `mockup/index.html`, and the proposal's question-round assumptions 1-5 apply.

## Architecture Decisions

| # | Topic | Choice | Rejected | Rationale |
|---|---|---|---|---|
| D1 | Hint logic | `service-orders/hints.ts` exports `statusBarHint`, `workLinesHint` and `blockedMoveReason`, each returning `Hint \| null` or a string. `transitions.ts` gains `isAllowedTransition(from, to)`, a non-throwing test that `assertTransition` reuses. | Strings inside each component; a `kanban/` copy | Node tests can cover every branch there. Kanban, the detail page and the work card share the copy, and `ALLOWED_TRANSITIONS` stays private. |
| D2 | Server/client split | The page calls `statusBarHint` on the server and renders the hint row itself, like vencimientos `waBlockedReason` (`vencimientos/page.tsx:22`). `OrderWorkCard` calls `workLinesHint` on the client, because `own` is derived there (`OrderWorkCard.tsx:152`). | Passing assignees and roster into `OrderStatusControls` | Only strings and booleans reach a client component, and no function crosses the boundary. |
| D3 | "Asignar técnico" | A new client `FocusTargetButton({targetId})`. On click it runs `el.scrollIntoView?.({block:"center"})` and then `el.focus({preventScroll:true})`. `AssignTecnicoControl` exports `ASSIGN_TECNICO_ID = "assign-tecnico"` and uses it at `:57,60`. When `assignable.length === 0` the select is not rendered (`:24`), so the action becomes `"technicians"`, a `Link` to `/technicians` built with `buttonVariants`, and only if `can(user,"technicians.manage")`. Otherwise the hint shows its text only. | An anchor `#assign-tecnico`; a ref passed across cards | The two cards are separate server subtrees. The DOM read happens in an event handler, so there is no hydration risk. jsdom lacks `scrollIntoView`, so the call is guarded. |
| D4 | "Editar orden" in hint 7 | The page mounts a second `ServiceOrderFormTrigger` in the hint row, with the same props as `page.tsx:186`. `OrderStatusControls` gains `receiveBlocked: boolean` (default `false`), which disables Recibir and sets `aria-describedby` to the hint's id. | A slot prop on the client control | This keeps the in-row button (assumption 3) with no new client wiring. The default keeps the existing tests at `OrderStatusControls.test.tsx:300-346` valid. |
| D5 | Short labels | Each button shows the short text, which is also its accessible name (no `aria-label`; WCAG 2.5.3, decided 2026-11-06 — this supersedes the original aria-label plan). The order is: the filled button first, the remaining `getManualTransitions` order, then a divider, then Cancelar. The filled button is the normal next step: booked→open, diagnosing→in_progress, on_hold→in_progress, ready_for_review→done. | Changing the accessible names | I checked the 64 "Marcar como" hits. Only `OrderStatusControls.test.tsx` (22) touches this bar. Its `getByRole({name})` queries keep passing. Its `labels()` helper reads `textContent` (`:163`), so 6 tests switch to the accessible name, and the `ready_for_review` order changes. The other 13 files are bulk, urgent, vencimientos and kanban copy, and they do not change. |
| D6 | Button colour | The buttons get `style` `--h`/`--s` from `STATUS_HUE[to]` and the class `hue-tint` or `hue-fill`. `button.tsx` gains a `hue` variant with no colour utilities. Cancelar uses the existing `destructive` variant with the `Ban` icon. | `outline` or `ghost` plus the hue class | The variant's `bg-background` and `hover:bg-muted` are utilities, and utilities beat `@layer components`, so they would win over the hue class. |
| D7 | CSS | In `@layer components` (`globals.css:204`): `.hue-tint` is 92% background with 28% text in light, and 18% background with 78% text in dark. `.hue-fill` is a 32% background with `#fff` text in light, and a 78% background with `var(--background)` text in dark. Both recipes include a hover state. `.board-hue-tile` stays at 32%. | Lowering the tile to 28% | The mockup measured 4.45:1 at 32% for done text. The tile carries only icons (3:1), so changing it would be a palette change. |
| D8 | Badge | Order statuses except `cancelled` render `hue-tint` with inline vars from `ORDER_HUE`. `cancelled` keeps its neutral line-through style, and the icons are unchanged (assumption 4). `shared/` never imports `modules/` (checked), which is why `ORDER_HUE` moves to `shared/ui/status-hue.ts` and `board/primitives.tsx` builds `STATUS_HUE` from it plus the icons. | Duplicating the hue numbers in CSS | This keeps a single source for the hue values. |
| D9 | Borrowed badge keys | Three callers use `status="done"` to mean "Activo": `TechnicianRoster.tsx:179`, `UsersTable.tsx:323` and `customers/page.tsx:361`. They move to `"completed"`, which has identical classes and icon today. Vencimientos uses `"in_progress"` for amber (`display.ts:22,27`); it moves to a new `"warning"` key with `TONE.warning`. `BacklogCounters` dots become `board-hue-bar` plus vars, since its comment says it follows the badge. | Leaving them alone | Without these moves, D8 would silently turn "Activo" and "Este mes" into order hues. |
| D10 | Kanban | `menuItems` gains `blocked: string \| null`, set for `canMove && status === "open"`. CardMenu renders it as a `DropdownMenuItem disabled` with the `Info` icon. MoveSheet renders it as a non-button row. `ColumnShell` gains `dropHint?: string`, and `DropColumn` passes `blockedMoveReason(dragged.status, status)`. `KanbanBoard.onMove` turns `plan.kind === "illegal"` into `addToast("info", reason + ".")`. | A toast from `DndBoard` | `onMove` is already the single path for both drop and menu, and the menu never offers an illegal target. |
| D11 | Empty list (8) | `service-orders/page.tsx` calls `findTecnicoByUserId(user.id)` only when `!readAll`, there is no filter and `items.length === 0`. It renders "No tenés órdenes asignadas." or the unlinked copy. All of it is server markup. | Querying it on every render | It is one indexed read, made only in the empty case. |

## Data Flow

    [id]/page.tsx ─ statusBarHint(status, missing, assignees, assignableCount, canAssign, canManageTechs)
       ├→ <OrderStatusControls receiveBlocked>          (client, buttons only)
       └→ hint row: text + FocusTargetButton | Link | ServiceOrderFormTrigger
    OrderWorkCard (client) ─ workLinesHint(status, own, assignees, canManageAll, mode) → text (+ FocusTargetButton)
    KanbanBoard ─ drop → planMove → illegal → addToast("info", blockedMoveReason)
    DropColumn ─ blockedMoveReason → ColumnShell dropHint

## Interfaces / Contracts

```ts
type HintAction = "assign" | "technicians" | "edit";
type Hint = { text: string; action?: HintAction };
statusBarHint(i: { status: OrderStatus; missing: ("vehiculo" | "categoria")[]; assignees: OrderAssignee[];
  assignableCount: number; canAssign: boolean; canManageTechnicians: boolean }): Hint | null;
workLinesHint(i: { status: OrderStatus; own: OrderAssignee | undefined; assigneeCount: number;
  canManageAll: boolean; mode: "write" | "correction" | "refused" }): Hint | null;
blockedMoveReason(from: OrderStatus, to: OrderStatus): string; // "Pasa sola…" only if allowed && automatic
```

"Faltan" lists the assignees that are `active && !parteLista`. When none qualify, the sentence is omitted. The `OrderWorkCard.tsx:196` branch is removed: `workLinesHint` owns the open-order case, which was unreachable before.

## File Changes

| File | Action |
|---|---|
| `src/shared/ui/status-hue.ts`, `src/modules/board/primitives.tsx`, `src/app/globals.css`, `src/shared/ui/StatusBadge.tsx` (+2 tests), `vencimientos/display.ts` (+test), the 3 "Activo" callers, `metrics/charts/BacklogCounters.tsx` | Create / Modify (D7-D9) |
| `src/components/ui/button.tsx`, `OrderStatusControls.tsx` (+test), `[id]/page.tsx` (+test) | Modify (D5, D6, layout) |
| `service-orders/hints.ts` (+test), `transitions.ts` (+test) | Create / Modify (D1) |
| `shared/ui/FocusTargetButton.tsx` (+test), `AssignTecnicoControl.tsx` | Create / Modify (D3, D4) |
| `OrderWorkCard.tsx` (+test) | Modify |
| `kanban/{CardMenu,MoveSheet,DndBoard,KanbanBoard}.tsx`, `board/primitives.tsx` `dropHint` (+tests, `DndBoard.test.tsx:83-103`) | Modify (D10) |
| `src/app/(app)/service-orders/page.tsx` (+test) | Modify (D11) |

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit (node) | Every `hints.ts` branch, including the role variants, ACTIVE filtering, Agendada→En diagnóstico ("Desde…" rather than "Pasa sola"), and `isAllowedTransition` | Strict TDD. Mutation-verify each branch and name the reverted line. |
| jsdom | Accessible names unchanged, order, `fill` and `aria-describedby`, the focus call (stub `scrollIntoView`), the disabled menu item, the info toast on illegal drop, both empty-state copies (mock `findTecnicoByUserId`) | Class pins only. jsdom computes no colour and no height. |
| Browser at the LAN IP | No clipping at 1280 with the sidebar, a full-width stack on phone, 44px, contrast of badges at 12px and buttons in light and dark, focus and scroll to the select, real mouse drag and tablet long-press with hint and toast, the `/tablero` customer badges, no RSC or hydration error in the console (a server element is passed into the hint row) | Required. No test can see any of these. |

## Threat Matrix

N/A. The change has no routing, shell, subprocess, VCS/PR automation, executable-classification or process-integration boundary.

## Work Units (tracker `feat/order-blocked-action-hints`, chained, ≤400 lines each)

| WU | Content | Owns | Est. |
|---|---|---|---|
| 1 | D7-D9 badge unification | status-hue, primitives (hue only), globals.css, StatusBadge, display.ts, Activo callers, BacklogCounters | ~220 |
| 2 | D5, D6 and the layout of the action bar | button.tsx, OrderStatusControls, `[id]/page.tsx` header | ~350 |
| 3 | D1 pure module | hints.ts, transitions.ts | ~280 |
| 4 | Detail hints 1, 3, 7 (D2-D4) | `[id]/page.tsx` hint row, FocusTargetButton, AssignTecnicoControl, `receiveBlocked` | ~300 |
| 5 | Work-card hints 4, 5, 6 | OrderWorkCard | ~220 |
| 6 | Kanban (D10) | CardMenu, MoveSheet, DndBoard, KanbanBoard, primitives `dropHint` | ~300 |
| 7 | Empty list (D11) | `service-orders/page.tsx` | ~150 |

WU5 and WU6 own disjoint files, so they can be written in parallel. WU5 needs WU3 and WU4: hint 5a reuses `FocusTargetButton`. WU6 needs WU1 and WU3, because WU1 also edits `primitives.tsx`. WU7 depends on nothing. WU4 follows WU2 because both edit `[id]/page.tsx`. The PR chain order is still 1→7.

## Migration / Rollout

No migration is required. Each WU can be reverted on its own.

## Open Questions

- [x] RESOLVED 2026-11-06: the visible label is the accessible name, no `aria-label`. Original question — WCAG 2.5.3 (Label in Name, level A). The visible "Completar", "Cancelar" and "Pasar a En progreso" are not substrings of their accessible names. The approved proposal keeps the full text in `aria-label`. The alternative is an accessible name that starts with the visible word, for example "Completar (marcar como Completada)", which needs mechanical edits to about 16 test queries. The owner decides.
