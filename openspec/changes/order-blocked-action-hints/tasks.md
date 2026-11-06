# Tasks: Order Blocked-Action Hints

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,820 across 7 PRs (tests counted); per-PR 150-350 |
| 400-line budget risk | Medium (WU2 ~350 and WU4/WU6 ~300 are the closest) |
| Chained PRs recommended | Yes |
| Suggested split | WU1 → WU2 → WU3 → WU4 → WU5 → WU6 → WU7 |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain (tracker `feat/order-blocked-action-hints` → main) |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: Medium

Branches: WU1 targets `feat/order-blocked-action-hints`; each later branch targets the previous WU branch: `feat/order-blocked-action-hints-wu1-badge-hue`, `-wu2-action-bar`, `-wu3-hints-module`, `-wu4-detail-hints`, `-wu5-work-card`, `-wu6-kanban`, `-wu7-empty-list`. Tracker merges to main last. No branch name contains main/master/develop.

Decision applied (overrides proposal/design/spec table): WCAG 2.5.3 Label in Name. Status buttons have NO `aria-label`; the accessible name is the visible short label ("Completar", "Cancelar", "Pasar a En progreso", "En espera · repuesto"). The spec's aria-label column and D5's "Changing the accessible names" rejection no longer apply.

Conventions for every WU: Strict TDD (RED confirmed failing BY NAME, then GREEN); mutation-verify every fix (revert, name the red test; a test that stays green is a placebo, fix or delete it); fixtures match the wire; no secure-context APIs; 44x44 on actions; Spanish copy verbatim from the specs/mockup. Final tasks of each WU: gates (`npm test`, `npx tsc --noEmit`, `npm run lint` = 0 errors, 13 warnings), mutation check, `gga run --pr-mode --diff-only` (pin `PR_BASE_BRANCH` to the previous WU branch), PR to the previous WU branch. Engram was not consulted for this phase (hybrid mode, filesystem inputs only); save `sdd/order-blocked-action-hints/tasks` when it is reachable.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Badge/hue unification (~220) | PR 1 → tracker | `npx vitest run src/shared/ui src/modules/board src/modules/vencimientos src/modules/metrics` | Browser: badge contrast light/dark, `/tablero/clientes` badges | `status-hue.ts`, CSS recipes, StatusBadge, caller key moves |
| 2 | Action bar short labels, hue buttons, layout (~350) | PR 2 → WU1 | `npx vitest run src/modules/service-orders/OrderStatusControls.test.tsx "src/app/(app)/service-orders/[id]"` | Browser LAN IP: 1280 no clip, 390 stack, 44px, contrast | `button.tsx` hue variant, `OrderStatusControls`, page header |
| 3 | Pure `hints.ts` + `isAllowedTransition` (~280) | PR 3 → WU2 | `npx vitest run src/modules/service-orders/hints.test.ts src/modules/service-orders/transitions.test.ts` | N/A: DB-free pure module | `hints.ts`, `transitions.ts` addition |
| 4 | Detail hints 1, 2, 3 (~300) | PR 4 → WU3 | `npx vitest run src/shared/ui/FocusTargetButton.test.tsx src/modules/service-orders "src/app/(app)/service-orders/[id]"` | Browser: focus/scroll, RSC/hydration console | page hint row, `FocusTargetButton`, `AssignTecnicoControl`, `receiveBlocked` |
| 5 | Work-card hints (~220) | PR 5 → WU4 | `npx vitest run src/modules/service-orders/OrderWorkCard.test.tsx` | Browser 390/768: hint beside button | `OrderWorkCard.tsx` |
| 6 | Kanban menu/sheet/drop hint/toast (~300) | PR 6 → WU5 | `npx vitest run src/modules/kanban src/modules/board` | Browser: mouse drag, tablet long-press, toast | kanban components, `dropHint` |
| 7 | Técnico empty list (~150) | PR 7 → WU6 | `npx vitest run "src/app/(app)/service-orders/page.test.tsx"` | Browser: técnico with no orders / unlinked | `service-orders/page.tsx` |

WU5 and WU6 own disjoint files and may be written in parallel (subagents, one per WU), branches still chained 5→6. WU4 follows WU2 (same `[id]/page.tsx`). WU6 follows WU1 and WU3 (WU1 edits `primitives.tsx`). WU7 depends on nothing.

## WU1: Badge and hue unification (D7-D9)

- [x] 1.1 RED `src/shared/ui/status-hue.test.ts`: `ORDER_HUE` exports the seven statuses with today's H/S numbers (done 142 55, on_hold 220 14, in_progress 290 50); GREEN create `src/shared/ui/status-hue.ts`; `board/primitives.tsx` builds `STATUS_HUE` from it plus icons (existing primitives tests stay green).
- [x] 1.2 RED `StatusBadge` tests (spec "Badge hue equals STATUS_HUE", "Cancelled keeps its own style"; En progreso and En espera differ; non-order uses unchanged); GREEN `StatusBadge.tsx` renders `hue-tint` with inline `--h/--s`, `cancelled` untouched; add `.hue-tint`/`.hue-fill` (+hover) in `globals.css` `@layer components`.
- [x] 1.3 RED `vencimientos/display` test: amber maps to new `"warning"` key; GREEN `display.ts` (+ `StatusBadge` `warning` key with `TONE.warning`).
- [x] 1.4 RED tests pinning `"completed"` for "Activo" in `TechnicianRoster.tsx:179`, `UsersTable.tsx:323`, `customers/page.tsx:361`; GREEN move all three.
- [x] 1.5 RED `BacklogCounters` test pins `board-hue-bar` plus `--h/--s` vars; GREEN edit `metrics/charts/BacklogCounters.tsx`.
- [x] 1.6 Mutation-verify 1.2-1.5; gates; GGA; PR.
- [x] 1.7 BROWSER (LAN IP, light+dark): badge text ≥4.5:1 incl. Completada at 12px; "Activo"/"Este mes" unchanged; `/tablero/clientes` badges; console clean.

## WU2: Action bar (D5, D6)

- [x] 2.1 RED `OrderStatusControls.test.tsx`: switch every "Marcar como …" query (19 hits) and the `labels()` helper to the visible short labels; confirm no aria-label drops visible words (name === visible text) and `ready_for_review` order is Completar, Volver a En progreso, divider, Cancelar. Run `rg "Marcar como" src` to confirm only this bar's test changes (bulk and list-page hits are different bars and stay).
- [x] 2.2 RED: icons per button with `Ban` on Cancelar; exactly one filled button on booked/diagnosing/on_hold/ready_for_review, none on open/in_progress; hue per target; `aria-hidden` divider before Cancelar; Cancelar `destructive`; técnico renders none.
- [x] 2.3 GREEN `src/components/ui/button.tsx` `hue` variant (no colour utilities); `OrderStatusControls.tsx` short labels, no `aria-label`, `style` vars from `STATUS_HUE[to]`, `hue-tint`/`hue-fill`, order and divider, stacked full-width below 640px container, 44x44.
- [x] 2.4 RED then GREEN `[id]/page.tsx` header (+test): Editar orden/Imprimir (Pencil, Printer) on the breadcrumb line, same visibility rules; card title row holds only title and badge; controls on their own row.
- [x] 2.5 Mutation-verify (fill rule, hue source, divider, order); gates; GGA; PR.
- [x] 2.6 BROWSER (LAN IP, light+dark, Chrome device extension for tablet/phone): 1280 with sidebar no clip, 390 full-width stack, ≥44x44, button contrast ≥4.5:1 incl. tinted and filled Completar.

## WU3: Pure hints module (D1)

- [ ] 3.1 RED `transitions.test.ts`: `isAllowedTransition(from,to)` true/false per table, never throws; `assertTransition` still throws. GREEN `transitions.ts`.
- [ ] 3.2 RED `hints.test.ts` `blockedMoveReason`: "Pasa sola al asignar un técnico" (open→diagnosing), "Pasa sola cuando todos marcan su parte lista" (in_progress→ready_for_review), booked→diagnosing and diagnosing→ready_for_review give "Desde … no se puede pasar a …", open→in_progress. GREEN `hints.ts`.
- [ ] 3.3 RED `statusBarHint`: open without assignee, assign vs `technicians` action (`assignableCount` 0), no action without `canManageTechnicians`; has assignee → null; in_progress "Faltan" lists only active unmarked in order; deactivated excluded; nobody unmarked → null; Faltan only on in_progress; booked missing vehiculo/categoria → edit action; complete → null. GREEN.
- [ ] 3.4 RED `workLinesHint`: every table row, jefe vs técnico, diagnosing técnico informational, in_progress/ready_for_review marked, nothing when writable or closed, exact strings. GREEN.
- [ ] 3.5 Mutation-verify each branch (name the reverted line); gates; GGA; PR. No browser task (pure module).

## WU4: Detail hints 1, 2, 3 (D2-D4)

- [ ] 4.1 RED `FocusTargetButton.test.tsx` (stub `scrollIntoView`; guarded when absent): click focuses `#assign-tecnico`. GREEN `shared/ui/FocusTargetButton.tsx`; `AssignTecnicoControl.tsx` exports `ASSIGN_TECNICO_ID` and uses it.
- [ ] 4.2 RED `[id]/page.test.tsx`: open order hint + "Asignar técnico" (admin and jefe); no `#assign-tecnico` → link "Ir a Técnicos" to `/technicians` only with `technicians.manage`, else text only; Faltan sentences; booked incomplete → Recibir disabled, Cancelar enabled, second "Editar orden" trigger; técnico sees no hint. GREEN page hint row via `statusBarHint`, server-rendered.
- [ ] 4.3 RED `OrderStatusControls.test.tsx`: `receiveBlocked` disables Recibir and sets `aria-describedby` to the hint id; default false keeps `:300-346` green. GREEN.
- [ ] 4.4 Mutation-verify; gates; GGA; PR.
- [ ] 4.5 BROWSER (LAN IP): scroll+focus on the select, no RSC/hydration error in console (server element in hint row), hint wraps at 390 with no overflow, 44px, light+dark.

## WU5: Work-card hints (disjoint from WU6)

- [ ] 5.1 RED `OrderWorkCard.test.tsx`, one test per spec scenario (open jefe with assign button / "Ir a Técnicos"; booked jefe/técnico; on_hold jefe/técnico; diagnosing técnico; marked técnico incl. ready_for_review; no hint when writable; closed; "Copy is exact"; old "solo el jefe de taller puede cambiar líneas" absent). GREEN `OrderWorkCard.tsx` via `workLinesHint`; remove the unreachable `:196` branch; hint row above "Todavía no hay líneas de trabajo.".
- [ ] 5.2 Mutation-verify; gates; GGA; PR.
- [ ] 5.3 BROWSER (Chrome device extension, 390 and 768, light+dark): hint beside/under button, no overflow, button ≥44x44.

## WU6: Kanban (D10; disjoint from WU5)

- [ ] 6.1 RED `CardMenu.test.tsx`: open card + jefe → first item disabled, `aria-disabled`, Info icon, then separator; click sends nothing and menu stays; absent for booked/técnico. GREEN `menuItems` `blocked` + `CardMenu.tsx`.
- [ ] 6.2 RED `MoveSheet.test.tsx`: first non-button row with the text; Cancelar orden keeps `Trash2`. GREEN.
- [ ] 6.3 RED `board/primitives.test.tsx` + `DndBoard.test.tsx:83-103`: `dropHint` text per origin/target; no "No se puede mover acá". GREEN `ColumnShell dropHint`, `DropColumn` via `blockedMoveReason`.
- [ ] 6.4 RED `KanbanBoard.test.tsx`: illegal drop → no request, info toast `reason + "."` (open→diagnosing, booked→diagnosing); own column silent. GREEN `onMove` illegal branch.
- [ ] 6.5 Mutation-verify; gates; GGA; PR.
- [ ] 6.6 BROWSER (LAN IP, Chrome device extension): real mouse drag and tablet long-press show hints readable and unclipped at 1280/768; toast on drop; menu text wraps ≤280px, row ≥44px; console clean.

## WU7: Técnico empty list (D11)

- [ ] 7.1 RED `service-orders/page.test.tsx` (mock `findTecnicoByUserId`): linked → "No tenés órdenes asignadas."; unlinked → unlinked copy; filter/search → "Ninguna orden coincide con el filtro." + "Limpiar filtro"; admin unchanged; técnico with orders no reason; lookup NOT called unless `!readAll`, unfiltered, empty. GREEN `page.tsx`.
- [ ] 7.2 Mutation-verify; gates; GGA; PR.
- [ ] 7.3 BROWSER (LAN IP): both técnico empty states against a real linked and an unlinked user.
- [ ] 7.4 Tracker: whole-chain integration check (`npm test`, `tsc`, `lint` on the tracker), then merge to main; archive per SDD discipline.
