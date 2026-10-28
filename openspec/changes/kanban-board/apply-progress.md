# Apply progress: kanban-board

## WU1: Urgent flag (tasks 1.1-1.7) - done

Branch `feat/kanban-board-wu1-urgent`.

- Schema: `urgente_at`, `urgente_by` (FK users, ON DELETE SET NULL) and CHECK `orden_urgente_by_needs_at` on `orden_servicio`; migration `0036_order_urgent.sql` (generated, SQL read by hand).
- `service-orders/urgent.ts#setUrgent`: locks via `lockOrderForMutation` (`canWrite: !isClosedStatus`), writes only the two urgent columns, and writes nothing when the order is already in the requested state.
- `POST`/`DELETE /api/service-orders/[id]/urgent`: `service-orders.assign`; 403 / 404 / 409 `order_closed`. `ROUTE_GUARDS` entry added.
- Eight `OrdenServicio` fixtures gained `urgenteAt: null, urgenteBy: null` (type-only).

Mutations run (each reverted afterwards; failing tests named):
- Closed guard dropped: unit `refuses a done|cancelled order and writes nothing`; e2e `the flag survives the order reaching done|cancelled, ... 409 both ways`.
- Idempotence dropped: unit `is idempotent: setting ... / clearing ...`; e2e `setting an urgent order again succeeds and keeps the first setter and time`.
- `updatedAt` written: unit `sets the flag with the actor and writes ONLY the two urgent columns`; e2e `jefe sets then clears; ... neither moves updatedAt`.
- Actor not recorded: unit `sets the flag with the actor ...`; e2e `jefe sets then clears ...`, `setting an urgent order again ...`.
- Route permission gate dropped: unit `403 for tecnico|pantalla ...`; e2e `a técnico and a pantalla get 403 ...`.
- Route 409 mapping dropped: unit `409 for a closed order, with a Spanish message`; e2e both `the flag survives ...` tests.
- DB CHECK dropped (on `dforce_e2e`): e2e `the database rejects urgente_by set while urgente_at is null`.
- FK changed to NO ACTION (on `dforce_e2e`): e2e `deleting the user who set it nulls urgente_by and keeps the flag` and the column/FK test.

Gates: `npm test` 253 files / 3916 tests; `npx tsc --noEmit` clean (needs the gitignored `next-env.d.ts`, absent from the worktree, else 2 image-import errors in `login/page.tsx`); lint 0 errors / 13 warnings; full e2e on a fresh `dforce_e2e` 32 files / 374 tests.

## WU2: Read model, API, guards, nav (tasks 2.1-2.9) - done

Branch `feat/kanban-board-wu2-read-model`.

- `board/sort.ts#compareInColumn`; `board/queries.ts` also selects `urgenteAt`, `vehiculoId`, `categoria`; `board/shape.ts` extracts `boardFields`, adds `urgent` to `BoardRow` and sorts through `compareRows` (status order, then `compareInColumn`).
- `kanban/shape.ts#toKanbanSnapshot` (only mapper emitting `id`, `categoria`, `missing`, `mine`), `kanban/queries.ts` (`viewerAssignments`, `kanbanData`), `kanban/derive.ts` (`deriveBoard`, `filterCards`), `GET /api/kanban` (`board.read`), "Kanban" nav entry below "Tablero" with a `Columns3` icon.
- Deviation: the `"/kanban"` ROUTE_GUARDS entry is NOT added here (task 2.6 said both). The completeness test requires the page file to exist, so the entry lands with the page in 3b.3. Until then the nav link points at a 404.
- KPI definitions (not in the spec text, chosen here): "En el taller" = open, diagnosing, in_progress, on_hold, ready_for_review; "Completadas hoy" = done with `statusSince` on today's Panama day; "Agendadas hoy" = booked with an appointment on today's Panama day; "Citas vencidas" = booked with an appointment before `generatedAt` (any day); "Urgentes" = displayed urgent cards.
- 401 is the proxy's job (the handler reads identity headers), as for `/api/board`; no handler-level 401 test.
- `viewerAssignments`'s `IN (ids)` scoping on the join is not observable from output (an assignment outside the board never flags a card), so it has no mutation test; it only bounds the query.

Mutations run (each reverted; failing tests named, all in the apply report).
Gates: `npm test` 258 files / 3946 tests; `npx tsc --noEmit` clean; lint 0 errors / 13 warnings; full e2e on a fresh `dforce_e2e` 33 files / 381 tests.

## WU3a: Tokens and primitives (tasks 3a.1-3a.4) - done

Branch `feat/kanban-board-wu3a-primitives`.

- `globals.css` (additive): `--board-canvas/-col/-tile/-tile-shadow`, `--urgent`, `--board-warn-bg/-border/-fg` in `:root` and `.dark` (mockup values), matching `--color-*` in `@theme inline`, and `.board-hue-tile/-bar/-ring/-drop` plus `.board-av` in `@layer components`.
- `board/alerts.ts#cardAlert(row, now, missing?)`: `{ kind: "overdue" | "hold" | "missing", text }` or null. Priority when several hold (not in the spec text, chosen here): missing data, then overdue appointment, then hold reason. `now` is the ISO `generatedAt`, never `Date.now()`. An `on_hold` row without a reason reads "En espera · hace ...". The TV boards omit `missing`, so they never show it.
- `board/primitives.tsx`: `STATUS_HUE` (hue, saturation, icon per column; no `cancelled`), `ColumnShell` (region + h2 + count + `ul`, optional empty text), `CardShell` (an `li` with grip/action/tags/alert/footer slots), `UrgentBadge`, `TimeChip`, `AlertStrip`, `TechAvatars`, `CategoryTag`.
- Contract notes for WU3b/WU7: `CardShell` takes `plate: string | null` and shows "Sin placa"/"Sin vehículo" for null, so the caller passes null for a missing vehicle (`BoardRow.plate` holds the TV's "Sin vehículo" string). Primitives have one size (kanban); the TV's large variant is WU7's to add. No `Asignada a vos` chip yet: it is a tag the 3b card passes into `tags`.
- Reused: `categoriaLabel`, `ORDER_STATUS` types. No `durationText` exists in this worktree (agenda branch only), so `alerts.ts` has a small private `agoText` ("1 h 10 min", "6 h", "3 días").
- Browser check of the tokens in light and dark is deferred to WU3b (no page renders them yet).

Mutations run (each reverted; failing tests named):
- Overdue branch removed: `alerts.test.ts` "a booked appointment ... reads" (all five). `booked` check dropped: "an appointment in the past on a non-booked order is not overdue". Overdue threshold shifted: "a booked appointment still ahead has no alert". Minutes remainder dropped: "... reads Cita vencida · hace 1 h 10 min".
- Hold branch removed: "an on_hold card reads ..." and "... with no reason still shows its age". Reason fallback emptied: the latter. Missing branch removed: three `missing ... reads` rows and "missing data wins over an overdue appointment".
- Stripe/border forced on: "an urgent card carries the red stripe and border; a plain one carries neither". Flame icon removed: "UrgentBadge is the red badge with an icon AND the text". TimeChip made red: "TimeChip is neutral". AlertStrip icon removed: the three "strip shows an icon and its text". sr-only names removed: both TechAvatars name tests. Avatar cap raised: "caps the visible avatars at three". CategoryTag null guard removed: "CategoryTag ... renders nothing without one". "Sin placa" reworded: "reads 'Sin placa' and 'Sin vehículo'". Empty text forced off: both ColumnShell tests. Done hue set to red: "keeps red (0) and amber hues out".
- Placebo found and repaired: an unused `useState` import did not trip the hook scan (it matches calls only). A real `useMemo` call, a `"use client"` directive, a `Date.now()` call and an `<a>` each trip "the module is neither a client component nor a hook user" or "render no button and no link".

Gates: `npm test` 260 files / 3984 tests; `npx tsc --noEmit` clean; lint 0 errors / 13 warnings. No DB work, so no e2e run.

## WU3b: Read-only board and page (tasks 3b.1-3b.4) - done, 3b.5 browser check left to the orchestrator

Branch `feat/kanban-board-wu3b-board`. Ships as two PRs: A (components) then B (page, guard, safety).

- A: `kanban/KanbanCard.tsx` (`KanbanCardView`: `CardShell` + `cardAlert` + tags + `TechAvatars` + time chip; the 44x44 ⋯ trigger opens a `DropdownMenu` whose only item is "Ver orden" linking `/service-orders/<id>`) and `kanban/KanbanBoard.tsx` (`useBoardSnapshot("/api/kanban")`, `deriveBoard` over the full set, `filterCards` for the cards, `compareInColumn` sort, six KPIs, filter chips, desktop arrows with `scrollBy`, phone tabs with `scrollTo` and an `onScroll` that sets the active tab).
- B: `app/(app)/kanban/page.tsx` (`board.read` else `PermissionDenied` before any query; one `now` for `kanbanData` and `toKanbanSnapshot`; `canMove` from `service-orders.assign`), its test with `assertPlain`, `kanban-safety.test.ts`, and the `"/kanban"` ROUTE_GUARDS entry deferred from 2.6.
- Deviation, "Actualizado hace N s": exact seconds need a clock that ticks while healthy. `useBoardSnapshot` ticks only while failing (pinned by its tests: "no timer behind but the poll") and lint forbids `Date.now()` in render. So healthy reads "Actualizado hace menos de 30 s" (polls land every 30 s) and a failing poll reads "Actualizado hace N s" from the hook's live `now`. A truly ticking label needs the hook to tick when healthy (touches the TV tests); left for the orchestrator to decide in 4a.
- Deviations from the mockup, to keep each PR under 400 lines: no KPI sub-captions (they need data derive does not produce), no right-edge fade on the scroller, phone tabs show the status icon without the colored tile, phone top bar "Actualizar" button absent (needs the hook's `refresh`, task 4a.4), and the sub-heading for a mover reads "Estado de las órdenes del taller." (the mockup's "Arrastrá una tarjeta..." would be false until WU6).
- The `Mis órdenes` empty text "Ninguna orden tuya en este estado" is chosen by the active filter, so a técnico on "Todas" sees "Sin órdenes".
- The board drops rows whose status has no column (`cancelled`), so "Todas" and the KPIs agree with what is shown even if the wire ever carried one.

Mutations run (each reverted; failing tests named):
- Board: `.sort(compareInColumn)` removed: "puts the urgent card first in its column, ahead of an older one". Cancelled filter removed: "filter chips carry counts ... " (Todas 7 vs 6). KPIs computed over the filtered cards: "shows the six KPIs from the whole set ...". Roster gate removed: "hides Mis órdenes without a roster row ...". `!canMove` inverted: "shows Solo lectura only when ...". Arrow direction dropped: "the desktop arrows scroll ...". `onScroll` neutered and tab jump zeroed: "phone tabs show the counts, jump to their column, and follow the scroll". Empty-copy for `mine` removed: "filter chips carry counts ...". Age seconds hard-coded: "says the snapshot is fresh, then how old it is ...". `aria-pressed` removed: "filter chips carry counts and aria-pressed ...".
- Card: plate not nulled: "a booked card with no vehicle and no category reads Sin placa ...". `mine` tag off: "hides Mis órdenes ... Asignada a vos". Trigger `size-11` to `size-8`: "the ⋯ button is 44x44 ...". Booked chip off: "a booked card shows the appointment time in Panama ...". `missing` not passed to `cardAlert`: the Sin placa test. Href changed: the ⋯ test.
- Page: `board.read` gate removed: "Pantalla is refused with PermissionDenied and nothing is queried" (and the ROUTE_GUARDS source-match test). `canMove` forced true: "tecnico gets the board with canMove=false ...". A function prop and a Date prop added: the three role tests (`assertPlain`). `now` not passed to the query: "reads for the viewer at one instant ...". `"/kanban"` guard entry removed: "every existing API route and page has a ROUTE_GUARDS entry".
- Safety: `crypto.randomUUID`, `toLocaleString` in a client file, `typeof window` and `setInterval` each added to `KanbanBoard.tsx`: the matching `kanban safety` test. No placebo found. The "one instant" test cannot catch two separate `new Date()` calls under a frozen clock; it pins only that the instant is passed.

Gates: `npm test` 264 files / 4009 tests; `npx tsc --noEmit` clean; lint 0 errors / 13 warnings. No DB work, so no e2e run.

