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


## WU4a: Rules, overrides, mutations, hook seq/refresh (tasks 4a.1-4a.5) - done

Ships as two PRs, each passing tsc and tests alone. A (174 lines): `kanban/plan.ts` (31) + `plan.test.ts` (62), `kanban/overrides.ts` (31) + `overrides.test.ts` (50). B (292 lines): `kanban/mutations.ts` (57) + `mutations.test.ts` (119), `board/useBoardSnapshot.ts` (+25/-6) + its test (+85).

- `planMove` order: noop, illegal (not in `getManualTransitions`, so `cancelled` stays plannable for the menu while `legalTargets` drops it for drops), incomplete, ask-reason, confirm, patch. `MovePlan` carries no payload; dialogs derive their copy from card and target.
- `applyOverrides`: `Override = { status?, urgent?, seq: number | null }`, `null` = pending, a number = hook `seq` at confirmation; dropped at `seq - o.seq >= 2`. Deviation from the design wording "dropped when the row matches": a pure function has no memory, so a matching row simply renders the row's own values and is returned by identity (the test pins the identity). Bound: a card another user moves inside the two-snapshot window shows the override for at most two more polls. `statusLabel` is recomputed from `ORDER_STATUS_LABEL`; `holdReason` and `statusSince` stay the server's until the next snapshot.
- `moveOrder`/`setUrgent` resolve, never throw. `CONNECTION_ERROR` comes from `@/shared/ui/messages`. A 2xx whose body carries no known `orden.status` is placed where it was sent (commented `shortcut`). Fixtures are the real bodies (full `orden` row, `{urgent}`, `{error:"stale_status",message}`, `{errors:{form}}`, `{error:"invalid_transition",from,to}`, `{error:"Forbidden"}`, `{error:"order_closed",message}`); the last two kinds of 4xx without text read the generic line. The route's own stale message says "agenda", hence the board copy `STALE_MOVE_ERROR`.
- Hook: `seq` (good polls only) and a stable `refresh()`. `refresh` runs the poll's own `run` behind the same `inFlight` guard; during a request it queues one re-run (`again`) so it never overlaps and an in-flight stale poll cannot swallow the post-move refresh. No new timer; cleanup replaces it with a no-op. A 401/403 clears the queued re-run.
- Left for 4b/later: the ticking "Actualizado hace N s" (3b.6) and the phone "Actualizar" button (`refresh` now exists).

Mutations run (each reverted; failing tests named):
- plan: `!canMove` dropped: "noop: the viewer cannot move ..."; same-column check dropped: "noop: the same column"; illegal guard removed: "illegal: ..."; `missing` check off: "incomplete: ..."; on_hold branch removed: "ask-reason: on_hold"; `done`, `cancelled` and the ready_for_review reopen each removed: "confirm: done, ready_for_review to in_progress, and cancelled"; `cancelled` kept in `legalTargets`: "excludes cancelled, diagnosing and ready_for_review".
- overrides: threshold 1, 3 or none: "keeps a confirmed move through one stale snapshot, and drops it at the second" and "clears urgent, and drops that override after two good snapshots too"; identity shortcut removed: "returns the very same row ..."; urgent ignored: "applies an urgent override on its own ..."; label not recomputed: "keeps a pending move over an in-flight stale poll ..."; empty-map shortcut removed: "leaves other rows alone ...".
- mutations: status from the target instead of `orden.status`: "places the card by orden.status ..."; fallback changed: "a 2xx with a body that carries no known status ..."; stale on any 409 / never: "a 409 that is not stale_status ..." / "409 stale_status reads the board copy ..."; message sources removed or swapped: "reads errors.form, then errors.esperaMotivo, then message"; connection error reworded: "a rejected fetch ..."; DELETE to POST: "POSTs to mark and DELETEs to clear"; PATCH to PUT, body trimmed: "PATCHes the move ..."; `ok` forced: the two setUrgent failure tests.
- Placebos found and repaired: the form-before-esperaMotivo order and the empty-string guard survived until a body with both keys and an empty `errors.form` beside a `message` were added; `again = false` on 401 survived until "a queued refresh is dropped when the poll in flight answers 401 ...".
- hook: `seq` frozen / constant: the three seq tests; failure bumps seq: "seq counts good snapshots only ..."; queue removed, or refresh returning when in flight, or the re-run disabled: "refresh() during a poll in flight waits for it ..."; cleanup no-op removed: "refresh() after unmount sends nothing"; `useCallback` removed: "refresh is the same function on every render"; poll interval changed: nine existing cadence tests.

Gates: `npm test` 267 files / 4044 tests; `npx tsc --noEmit` clean; lint 0 errors / 13 warnings. No DB work, no browser work.


## WU4b: Menu, dialogs, optimistic wiring (tasks 4b.1-4b.3; 4b.4 unit/mutation part) - done, browser check pending

Ships as two PRs, each passing tsc and tests alone. A (317 lines): `kanban/CardMenu.tsx` (58) + `CardMenu.test.tsx` (58), `ConfirmMoveDialog.tsx` (44), `EsperaDialog.tsx` (44), `IncompleteDialog.tsx` (35) + `MoveDialogs.test.tsx` (78). B (249 lines): `KanbanBoard.tsx` (+58/-6), `KanbanCard.tsx` (+5/-15), `KanbanBoard.test.tsx` (+3), `KanbanCard.test.tsx` (+1/-1), new `KanbanBoard.move.test.tsx` (160).

- Process note: the implementation of half A was written before its tests (not a true RED); the tests were then proven meaningful by mutation (below), as AGENTS.md allows for a retrofit.
- `menuItems(card, canMove)` returns `{ targets, cancel }` (targets = `legalTargets`, cancel = `cancelled` in `getManualTransitions`); a técnico gets neither, so only "Ver orden" shows. The submenu is `DropdownMenuSub` (first use in the repo; it works in jsdom, but the browser check must confirm keyboard/touch behaviour).
- Wiring: `planMove` -> dialog (`ask` state) -> `send` = override pending -> `moveOrder` -> rollback + error toast on failure, or override pinned to the status the server returned (`seq` read from a ref updated in an effect, since the closure holds the click-time value) + success toast + hook `refresh()`. `moveOrder` never throws, so toast and refresh sit below its failure handling, per the pattern.
- `router.refresh()` is NOT used (deviation from the spec wording, decided from code): `KanbanBoard` keeps `initial` only as `useState` seed inside `useBoardSnapshot`, so a server re-render changes nothing on screen; the hook's `refresh()` fetches `/api/kanban` now. One-line comment in the code.
- Deviation, `matchMedia` (tasks 4b.1, design D12): NOT implemented here. The narrow branch opens the bottom sheet, which is WU5 (`MoveSheet.tsx`); a click-time read with nothing to switch to would be dead code. WU5 adds the click-time read and the sheet. Until then the phone gets the same dropdown (44px rows, tap-to-open submenu).
- Extra guard (not in the spec): a card whose previous move is still pending ignores a new move, so `expectedStatus` can never be built from an optimistic status that the server has not confirmed. Tested.
- Copy not given by the spec/mockup, written by me and flagged for the owner: ready_for_review -> in_progress dialog ("¿Devolver la orden a En progreso?", "Se reabren todas las partes: las marcas de listo se borran.", "Sí, devolver"; the claim is `service.ts` clearing `parteListaAt`), and Cancelar orden ("¿Cancelar la orden?", "La orden queda cancelada y no se puede reabrir.", "Sí, cancelar orden", dismiss "Volver" so "Cancelar" does not read as both). The Completada text is the approved mockup's. The mockup's hue tiles on submenu rows and the order-line car icon were left out.
- On a failed move the board does not refresh (no extra request); the card returns to its place and the next 30 s poll corrects a stale one.

Mutations run (each reverted; failing tests named). Half A: `canMove &&` dropped from `cancel` or `targets` forced: "offers drop targets without cancelled ..." and "a técnico (canMove false) sees only Ver orden"; submenu always rendered: "omits Mover a… when no target is legal ..."; Cancelar orden reporting `done`: the same test; Pasar a En espera never disabled: "keeps Pasar a En espera disabled until a reason is chosen ..."; danger variant dropped: "styles only the cancellation as danger"; all missing fields listed: "lists only what is missing ...". Half B: toast and `refresh()` swapped: "a plain move sends status and expectedStatus, places the card, and toasts BEFORE the refresh goes out"; rollback `setOverride(null)` removed, or error toast removed: both "409 stale_status rolls the card back ..." and "400 with the server's own line rolls the card back ..."; placed by target instead of `orden.status`: "places the card where the server put it ..."; dismiss wired to confirm: "a dismissed Completada dialog sends nothing ..."; pending guard removed: "a poll landing while the PATCH is pending ..."; `canMove` forced true: "a viewer who cannot move gets no move items from the board"; `expectedStatus` dropped: three PATCH-body tests; `applyOverrides` removed: five tests incl. the poll one; `esperaMotivo` not forwarded: "En espera asks the reason first ..."; confirmed `seq` forced to 0: the poll test; `incomplete` not opening its dialog: "receiving an incomplete booked order ...".
- Placebos found: none surviving. Three first-round mutations (toast order, rollback, error toast) reported green only because `sd -F` silently skips a multi-line pattern; redone with a script, all red by name.

Gates: `npm test` 270 files / 4066 tests; `npx tsc --noEmit` clean; lint 0 errors / 13 warnings. No DB work. Browser check (4b.4) still open: see the report.

## WU5: Urgent item and phone sheet (tasks 5.1, 5.2; 5.3 unit/mutation part) - done, browser check pending

One PR, 340 changed lines (88 added / 18 removed in five existing files; new `MoveSheet.tsx` 63, `MoveSheet.test.tsx` 63, `KanbanBoard.urgent.test.tsx` 108).

- `menuItems(card, canMove)` now returns `{ targets, cancel, urgent }`; `urgent` is `"mark" | "clear" | null`, null for a técnico and for a `done` card (the server answers 409 `order_closed`, so the toggle is not offered). Order in the menu: Mover a…, urgent, Ver orden, Cancelar orden.
- Board: `sendUrgent` mirrors `send`: optimistic `urgent` override (merged over the card's existing override so a confirmed move is not lost), `setUrgent`, rollback to the previous override plus the server's own error line on failure (incl. the 409 `order_closed` message), success toast above `refresh()`. Same in-flight guard as moves.
- `matchMedia` (design D12): read ONLY in the menu's open request (`onOpenChange`), never in render. The query is `(max-width: 767px)`, the exact complement of the agenda's `min-width: 768px`, so the jsdom shim (`matches: false`) means "wide" and the 4b tests keep exercising the dropdown. Narrow opens `MoveSheet` (`Sheet side="bottom"`, own 44px "Cerrar"), wide opens the controlled dropdown.
- `MoveSheet` shares `menuItems`; header = plate (or "Sin placa") + Urgente badge, description = make, model, status. Rows `min-h-11`. Hue icons on the target rows come from `STATUS_HUE`; the mockup's coloured hue tiles were not copied.
- No-drag-on-phone is vacuous until WU6 (no draggable exists yet); WU6 must test it.
- Known limit: a move started right after an urgent toggle replaces the card's override, so for up to two polls the urgent badge can fall back to the last polled value. Not fixed (WU4b `send` untouched).

Mutations (each reverted, failing tests named): `canMove` dropped from `urgent`: "a técnico (canMove false) sees only Ver orden", "a técnico gets only Ver orden; a done card gets no toggle", "offers the urgent toggle in the direction ..."; `done` check dropped: "a done card has no toggle", "a done card offers no toggle even for the jefe", "a técnico and a done card get no toggle"; desmarcada copy swapped: "clearing DELETEs and toasts the desmarcada copy"; rollback removed: "a 409 order_closed rolls the card back ..."; toast after refresh: "marking POSTs, sorts the card first ... BEFORE the refresh goes out"; always-menu: "a narrow viewport opens the bottom sheet ..." and "on a phone the same row lives in the bottom sheet and closes it"; always-sheet: 23 failures; optimistic override removed: PLACEBO first (the fetch resolved instantly), repaired with "the card is sorted first and badged while the request is still in flight", now red; sheet row height, close-on-choose, `side`, `canMove` forced true: each red in `MoveSheet.test.tsx`; POST/DELETE verb: "POSTs to mark and DELETEs to clear" and the DELETE board test.

Gates: `npm test` 272 files / 4084 tests; `npx tsc --noEmit` clean; lint 0 errors / 13 warnings.

## WU6: Drag and drop (tasks 6.1, 6.2, 6.3; 6.4 unit/mutation part) - done, browser check pending

One PR, about 250 changed lines excluding the lockfile (tracked +55/-9 in five files; new `DndBoard.tsx` 65, `DndBoard.test.tsx` 120).

- 6.1: `npm install --save-exact @dnd-kit/core@6.3.1` in this worktree. `package.json` +1 line; the lockfile gained `@dnd-kit/core`, `@dnd-kit/accessibility@3.1.1`, `@dnd-kit/utilities@3.2.2`. Peers are `react >=16.8.0` / `react-dom >=16.8.0` (core's `package.json`, lock entries): no conflict with react 19.2.4.
- `DndContext` `id` is NOT needed. `node_modules/@dnd-kit/core/dist/components/DndContext/DndContext.d.ts:11` declares `id?: string`; `core.esm.js:2903` feeds it to `useUniqueId("DndDescribedBy", id)`, which (`@dnd-kit/utilities/dist/utilities.esm.js:170-180`) falls back to a MODULE-LEVEL counter (`ids[prefix]+1`), so server and client counters differ. That id reaches the DOM only through `attributes['aria-describedby']` (`core.esm.js:3438`) and the `HiddenText`/`LiveRegion` of `Accessibility`, which returns null until its own mount effect (`core.esm.js:97-100,161`). We never spread `attributes`, and `DndContext` mounts only after `useSyncExternalStore(subscribeNever, () => true, () => false)` is true (D11a), so no generated id can be in server markup. The `accessibility` option exists (`DndContext.d.ts:12-17`).
- Deviation from D11c (phone): no `matchMedia` store. The drag activator is the grip, hidden below md by CSS (`max-md:hidden`, same 767 px edge as the sheet), so it cannot be pressed on a phone; nothing is read at render, so nothing can mismatch. Tested by pinning the class (jsdom has no layout); the 390 px browser check is the real proof.
- Deviation from D10 (activator): listeners are on the GRIP (44x44, `touch-none`), not on the card. React synthetic events bubble through portals, so listeners on the card would see presses on the portalled menu items; a 250 ms press on a menu item at a tablet would start a drag. The rest of the card keeps scrolling by touch.
- `collisionDetection={pointerWithin}`: the column under the finger/pointer, not rect overlap with the card.
- `DragOverlay dropAnimation={null}`: the board shows the optimistic result already; an illegal drop has nothing to animate. The overlay is in the tree (`inert` `ul`, rotated/scaled per mockup `.lifted`), no `createPortal`.
- Announcements silenced (`accessibility.announcements`): drag is pointer-only (no KeyboardSensor), and the defaults are English text naming the order id (`core.esm.js:48`). Side effect: dnd-kit's live region is a second `role="status"`; `KanbanBoard.test.tsx` line 133 now looks through all of them for the banner.
- Drop = `onMove` (the menu's function): `planMove` -> dialog or `moveOrder`. `DropColumn` lights `legalTargets(dragged.status)` with `board-hue-ring` and dims the rest (`opacity-40 grayscale` on every child but the hint) with the "No se puede mover acá" pill; the source column is untouched. `ColumnShell` gained `rootRef`/`dropState`, `CardShell` gained `rootRef` (TV unchanged).
- Skipped: the mockup's "Soltá para pasar a X" box inside legal columns (it would insert a block mid-drag and shift measured rects; spec does not require it).
- Known risk: `board-hue-ring` is a 2 px box-shadow on a column inside an `overflow-x-auto` scroller, so the ring may clip at the top edge. Check in the browser.
- On hydration `DndBoard` swaps `children` for `<DndContext>{children}</DndContext>`, which remounts the board subtree once (no user state exists yet).

Mutations (each reverted; failing tests named): every column legal: "lights the legal columns and dims the others ..."; never dim: same plus "dropping on an illegal column does nothing ..."; `planMove` illegal -> patch: "dropping on an illegal column does nothing ..."; grip for everyone, or `disabled` forced false: "a técnico (canMove false) has no grip"; `max-md:hidden` removed: "the grip is hidden on a phone ..."; wrapper before mount: "renders exactly its children on the server ..."; gate removed + `attributes` spread: "hydrates the server markup of the whole board ..."; drop ignored: "drops on a legal column through the same path as the menu ..." and "a plain drop sends the same PATCH ...". Not detected, by design: `attributes` spread WITH the gate kept (the gate alone keeps ids out of the server markup). Placebo repaired: the técnico test's "mouse press starts nothing" half could not fail (no grip to press), so it was removed.

Gates: `npm test` 273 files / 4092 tests; `npx tsc --noEmit` clean; lint 0 errors / 13 warnings.

## WU6 GGA fixes

- Overlay double registration (confirmed in source): `useDraggable` does `draggableNodes.set(id, {key,...})` and its cleanup deletes the entry when `node.key === key` (`@dnd-kit/core/dist/core.esm.js:3416-3429`). The overlay's `KanbanCardView` registered the same id with its own key, replacing the column card's entry, and its unmount deleted it. Trace: SET original, SET overlay, DEL on drop. Fix: `KanbanCard.tsx` split into `KanbanCardView` (draggable wrapper) + `KanbanCardBody` (presentational); the overlay renders `KanbanCardBody`.
- jsdom could NOT reproduce a user-visible failure of a second drag (the second overlay re-registers the id), so the test pins the registry instead: "a drag leaves the dragged card registered ..." (`DndBoard.test.tsx`). Mutation (overlay back to `KanbanCardView`): red by name.
- `OrderLine` (`ConfirmMoveDialog.tsx`, also used by `EsperaDialog`) printed the TV's "Sin vehículo" as the plate; now `missing.includes("vehiculo") ? "Sin placa" : plate`, same rule as `MoveSheet`/the card. Test "OrderLine reads Sin placa ..." (`MoveDialogs.test.tsx`); mutation (revert to `card.plate`): red by name.

## WU7: TV restyle (tasks 7.1, 7.2; 7.3 unit/mutation part) - done, browser check pending

One PR, 225 changed lines (+157/-68): `primitives.tsx` (+`tv` scale prop on `ColumnShell`, `CardShell`, `UrgentBadge`, `TimeChip`, `AlertStrip`, `TechAvatars`; `ColumnShell` gained `more`), `WorkshopBoard.tsx`, `CustomerBoard.tsx` and their tests. No split needed.

- Both boards render `ColumnShell` (the `section` is still a direct child of the grid wrapper) and the shared cards; technician names are initials plus the sr-only "Ana, Beto"; urgent shows the badge and the red edge; no control anywhere.
- Deviation from design D15 / task 7.1 ("`on_hold` age in the alert"): the TV keeps the pinned strings in their own elements, so the amber strip holds the hold reason alone ("Repuesto") and the age stays the neutral chip ("2 d"). Merging them ("Repuesto - hace 2 dias") would break `WorkshopBoard.test.tsx` "Repuesto" and "2 d", which are the spec. Overdue booked still uses `cardAlert`.
- `BoardRow.plate` carries the literal "Sin vehiculo"; the TV card maps it to a null plate ("Sin placa") so the two lines do not repeat.
- Customer board: own `li` in the same aesthetic (plate, `Car` icon + vehicle, `StatusBadge`), header count is the full column count, `MAX_ROWS=8` and `+N mas` kept via `ColumnShell.more`.
- Existing pinned tests untouched; 6 added (urgent badge + edge + no "falta", sr-only names, hold strip + overdue, column counts, customer count, customer card text).

Mutations (each reverted, red by name): urgent badge removed: "an urgent row carries the Urgente badge ..."; `urgent={false}` was a PLACEBO (passed), repaired with the `border-urgent/45` assertions, now red; hold via `cardAlert`: "shows the hold reason only on an on_hold row", "the hold reason sits in the amber strip ..."; alert dropped: same two; count 0: 9 tests; control injected: "carries no control"; slice removed / `+N` removed: "clips a long column ..."; Car icon removed: "a card is plate, vehicle (with its icon) ..."; count capped to 8: "the header counts every order ..."; `compareInColumn` urgent term removed: "puts an urgent card before ...", "Urgent first within a status ...".

Gates: `npm test` 273 files / 4100 tests; `npx tsc --noEmit` clean; lint 0 errors / 13 warnings.
