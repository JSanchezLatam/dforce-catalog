# Apply progress: workshop-status-board

## WU1 (branch `feat/workshop-status-board-wu1`) - 1.1-1.10 done, 1.11 partial

### Files changed
- Migration: `src/shared/db/migrations/0035_role_pantalla.sql` (single `ALTER TYPE ... ADD VALUE 'pantalla';`, generated with `npm run db:generate -- --name=role_pantalla`), `meta/_journal.json`, `meta/0035_snapshot.json` (both generated), `src/shared/db/schema.ts`.
- Source: `auth/roles.ts`, `auth/policy.ts` (all-false `pantalla` row, no new Action), `auth/session.ts` (`sessionTtlMs`, `issueSession(userId, role)`), `auth/authenticate.ts`, `auth/landing.ts` (new), `auth/actions.ts`, `app/page.tsx`, `service-orders/edit-policy.ts`, `account/service.ts` (role copy x2).
- Tests: `session`, `authenticate`, `landing` (new), `actions`, `app/page.test.tsx` (new), `policy`, `edit-policy`, `scope`, `roles`, `UserForm`, `UsersTable`, `account/service`, `schema.test.ts` (enum values list updated), `src/e2e/pantalla-role.e2e.test.ts` (new, 9 tests).

### Mutation-verify (reverted fix, named test went red, restored)
- TTL pantalla 180->7: "Lifetime per role - sessionTtlMs() > pantalla gets the lifetime its role calls for"
- landing -> `/inventory`: "Landing per role - landingPathFor() > pantalla lands where its role belongs" and "/ - Landing per role > sends pantalla to /tablero/clientes"
- pantalla cell true: "Matrix row: pantalla is false for every action ..."
- copy dropped in createUser / in updateUser: "Role error copy: rejects an unknown role rather than trusting the caller, in Spanish" / "Role error copy: rejects an unknown role in Spanish, and writes nothing"
- second statement using `'pantalla'` in 0035: e2e "pantalla is a valid role value and a user row with it inserts"
- e2e extras: TTL 7 d -> "session lifetime follows the role ..."; `account.self` granted -> "a forged pantalla is denied every application page and GET /api/users"; reset without revoke and deactivate without revoke -> "deactivation and password reset revoke every session of a pantalla account" (each separately); admin-floor wrapper neutralised -> "with one active administrador and pantalla users ... last_active_admin".

### Gates
- `npm test`: 221 files, 3590 tests passed. `npx tsc --noEmit`: clean. `npm run lint`: 0 errors, 13 warnings.
- e2e (fresh `dforce_e2e`, full suite): 24 files, 320 tests passed, 0 skipped.

### Not done / unchecked
- 1.11 closing steps (GGA, push, PR) left to the orchestrator.
- The spec mentions a role *filter* in the user list; no role filter exists in the code (only selector and badge), so none was touched.
- Pages in e2e (g) are called as functions with forged headers (`next/headers` mocked), not through `proxy.ts`; no browser check (WU4).
- Task 1.3 "order scoping" test passes without code change (pantalla already falls through the technician EXISTS path); it is a regression guard, not a RED.

- WU3 must write the `pantalla` MATRIX row literally when `board.customer` arrives (GGA WU1 note: the `Object.fromEntries` cast disables the missing-grant tsc check).

## WU2 (branch `feat/workshop-status-board-wu2`) - 2.1-2.9 done, 2.10 left to the orchestrator

### Files
- New: `src/modules/board/{format,shape,queries}.ts`, `format.test.ts`, `shape.test.ts`, `queries.privacy.test.ts`, `src/e2e/board.e2e.test.ts`.
- Modified: `src/modules/portal-sync/snapshot.ts` (`export` on `CUSTOMER_STATUS`, one keyword).
- No route, no Action, no UI.

### Behaviour notes
- `formatAge(sinceIso, nowIso)` takes ISO strings (the wire shape). Output follows the task text literally: "hace 12 min" under an hour, then "3 h", then "2 d" (no "hace" on hours/days). Mixed prefix is a copy question for the owner.
- Full-board row keys: `status`, `statusLabel`, `plate`, `make`, `model`, `holdReason` (null unless `on_hold`), `technicians`, `statusSince`; `appointmentAt` exists ONLY while `booked` (null if booked has no appointment). No-vehicle: `plate` = "Sin vehículo", make/model null. Hold-reason label is `ESPERA_MOTIVO_LABEL` ("Repuesto").
- Customer rows: `plate`, `make`, `model`, `status` only; vehicle-less, `booked` and `cancelled` rows are dropped by the mapper as well as by the query.
- Done-today boundary: `toWorkshopDateKey(now)::timestamp AT TIME ZONE 'America/Panama'`, as in metrics/queries.ts. `max(changed_at)` comes back as a `Date` (verified in e2e via `.toISOString()`), so `since as BoardSinceRow[]` only drops the nullable type.
- `queries.ts` avoids the word "cliente" even in comments, because the privacy test is a text match.
- `shape.ts` imports `portal-sync/snapshot` (node:crypto): server-only. WU3 client components must import TYPES from it only.

### Mutation-verify (fix reverted, named test red, restored)
- Panama -> 'UTC' in boundary: e2e "Done yesterday is dropped at Panama midnight: ..."
- `max` -> `min` history: e2e "Latest history row wins, the fallback is updated_at, ..."
- leftJoin -> innerJoin vehiculo: e2e "Booked order without a vehicle is on the full board, ..."
- customer query includes booked: e2e "Statuses included and excluded: ..." and "Booked order without a vehicle ..."
- spread source row in mapper: "Sentinel poison never leaks: ...", "row keys equal the whitelist exactly", "appointmentAt only while booked"
- drop booked-only guard on appointmentAt: "appointmentAt only while booked" and "row keys equal the whitelist exactly"
- drop on_hold guard on hold reason: "Hold reason only while on hold: ..."
- local status map in customer mapper: "the board holds no status map of its own: ..." (source test)
- `import { cliente }` appended to queries.ts: "never mentions the cliente table, its schema export or its columns"
- drop `plate === null` filter: "drops orders with no vehicle"; drop status ordering: "Ordering is stable: ..."

### Gates
- `npm test`: 224 files, 3620 tests passed. `npx tsc --noEmit`: clean. `npm run lint`: 0 errors, 13 warnings.
- e2e, fresh `dforce_e2e`, full suite: 25 files, 326 tests passed, 0 skipped (board.e2e: 6 tests).

### Size
- vs `feat/workshop-status-board-wu1` (untracked included): 513 lines (production 142, tests 371; e2e file alone 155). Over 400: pre-agreed escape is shipping `src/e2e/board.e2e.test.ts` as a sub-PR (then 358).

### Unchecked
- The e2e DB zone is UTC (`show timezone`); a non-UTC server/DB zone was not exercised (the boundary is explicit Panama SQL and an Intl date key, so it should not matter, but it was not run).
- "History rows of another order are not counted" is asserted (neighbour with a later row does not change the other order's start) but has no mutation: `groupBy ordenId` cannot be removed without a SQL error.
- Technician batching has no mutation-verify.
- 2.10 (GGA, push, PR) not done.

## WU3 (branch `feat/workshop-status-board-wu3`) - 3.1-3.8 done, 3.9 left to the orchestrator

### Files
- Production: `auth/policy.ts` (`board.customer` in `ACTIONS`; the `pantalla` MATRIX row is now written literally, every action spelled out, so a missing grant is a tsc error again; tecnico false, jefe/admin true), `app/api/board/clientes/route.ts` (`handleCustomerBoard`: `requireSession` -> `can` -> query -> `toCustomerSnapshot`; JSON 500 on any error; GET only; `Cache-Control: no-store`), `app/tablero/{layout,error}.tsx`, `app/tablero/clientes/page.tsx`, `board/{useBoardSnapshot.ts,StaleBanner.tsx,CustomerBoard.tsx}`.
- Tests: `policy.test.ts`, `route-guards.test.ts` (two `ROUTE_GUARDS` keys), `board/{useBoardSnapshot,StaleBanner,CustomerBoard}.test.tsx` (CustomerBoard.test also holds the insecure-context and types-only-import source tests), `app/api/board/clientes/route.test.ts`, `app/tablero/clientes/page.test.tsx`, `app/tablero/error.test.tsx`, `src/e2e/board-routes.e2e.test.ts` (6 tests, separable).

### Behaviour notes / deviations
- Hook returns `{ snapshot, lastOkAt, failedAt }`. The banner is a pure function of those two numbers (no clock of its own) and renders only when `failedAt - lastOkAt >= 60 s`, so the text is never "0 min" and "min 1" holds. With a 30 s poll the first failed poll never shows it; the second does.
- Customer rows carry no instant, so "ages against generatedAt" has nothing to apply to in `CustomerBoard` (it applies to WU4's full board). `formatAge` is unused here.
- Overflow: 12 rows per column, then `+N más`.
- A 2xx whose body is not `{generatedAt: string, rows: array}` is a failed poll (`looksLikeSnapshot`); row contents are not validated.
- No `usePollWhileActive`, no `router.refresh`.
- Page passes only `{ initial: CustomerSnapshot }` (ISO strings, plain objects); the page test asserts a JSON round trip equals it.
- Client bundle: `CustomerBoard.tsx`, `StaleBanner.tsx`, `useBoardSnapshot.ts`, `error.tsx` import only react, `StatusBadge` and `import type` from `./shape` (grepped, and a source test enforces `import type` for shape/snapshot/queries/node:crypto/portal-sync). `next build` NOT run (it would overwrite `.next` under the dev server on :3000).

### Mutation-verify (fix reverted, named test red, restored)
- `can()` neutralised in route: unit "Técnico is denied the customer view: 403 JSON, and nothing is queried"; e2e "tecnico is refused by the route (403 JSON) and by the page".
- `can()` neutralised in page: "renders PermissionDenied for a técnico and never calls the query".
- poller skips on `document.hidden`: "a hidden tab still polls" (jsdom reports `hidden` true by default, so the other poll tests also go red; the named one is the intended signal).
- 403 sent to /login: "403 navigates to / and NOT /login". `{ cache: "no-store" }` dropped: "polls every 30 s with cache no-store, and not before". In-flight guard removed: "never overlaps requests: a slow poll holds the next ticks back". `clearInterval` on 401/403 removed: "401 navigates to /login and keeps no further timers" and the 403 one. Shape check removed: "Failure keeps the snapshot: a 200 of the wrong shape" (and "a 500").
- banner `minutes < 1` guard removed: "is hidden while less than a minute has elapsed..." and CustomerBoard "keeps every row and shows the banner once a minute...". U+00B7 -> "-": "reads exactly `Sin conexión · actualizado hace 1 min` (U+00B7) once a minute elapsed".
- error.tsx `clearTimeout` removed: "does not reload after it is unmounted"; 60 s -> 5 s: "says it is retrying and reloads the page after 60 s, not before".
- `pantalla`/jefe cell flipped: "Matrix row: pantalla is true for board.customer ..." / "Access Matrix: board.customer is for administrador, jefe_taller and pantalla, never tecnico".
- `ROUTE_GUARDS` entry deleted (each of the two): "every existing API route and page has a ROUTE_GUARDS entry"; both entries set to session-only: "every Action with a route in v1 is reachable". Extra exported POST: "declares every method the route exports" and "exports GET only".
- route `catch` removed: unit "a database error is a JSON 5xx, never an HTML page" and e2e "a database failure on the real path is a JSON 5xx, not an HTML page". `.slice(0, MAX_ROWS)` removed: "clips a long column with `+N más`". Value import from `./shape` / `navigator.clipboard` added to client files: the two insecure-context source tests.
- NOT run: "Labels equal the portal's" (WU2 test, `shape.ts` untouched here; mutation-verified in WU2).

### Gates
- `npm test`: 230 files, 3659 tests passed. `npx tsc --noEmit`: clean. `npm run lint`: 0 errors, 13 warnings.
- e2e, fresh `dforce_e2e`, full suite: 26 files, 332 tests passed, 0 skipped (board-routes.e2e: 6).

### Size
- vs `feat/workshop-status-board-wu2-e2e`, untracked included, openspec excluded: 786 added / 7 deleted. Production 213 (the literal pantalla row is 29 of it), tests 573, of which `src/e2e/board-routes.e2e.test.ts` is 159. Without the e2e file: 627. Over 400 either way; the pre-agreed split is the e2e file as its own sub-PR, and the component tests could be a second.

### Unchecked
- No browser check (WU4): RSC serialization of the page props, hydration, the banner text on a real stop/restart, 401 on a real revoked session, TV legibility, chrome-less look. jsdom cannot see any of these.
- e2e drives `handleProxy` then the route by forwarding the proxy's `x-middleware-request-*` headers by hand; the real Next runtime was not involved.
- `error.tsx` is not reachable when `proxy.ts` throws (known follow-up).
- 3.9 (GGA, push, PR) not done.

## WU4 (branch `feat/workshop-status-board-wu4`) - 4.1-4.7 and F1 done; 4.8-4.10 left to the orchestrator

### Files
- Production: `auth/policy.ts` (`board.read`: administrador, jefe_taller, tecnico true; pantalla false), `app/api/board/route.ts` (`handleBoard`, same shape as the customer route: `requireSession` -> `can` -> `workshopBoardData` -> `toBoardSnapshot`; JSON 403/500; GET only; `no-store`), `app/tablero/page.tsx`, `board/WorkshopBoard.tsx` (7 columns in spec order, empty ones kept; ages via `formatAge(statusSince, snapshot.generatedAt)`; appointment time via the existing `formatDateTime` helper, fixed to `America/Panama`; hold reason only when `status === "on_hold"`, appointment only when `status === "booked"`; no control), `layout/nav-items.ts` ("Tablero" -> `/tablero`, icon key `board`, action `board.read`, in CRM), `components/app-sidebar.tsx` (`board: LayoutDashboard`), `board/queries.ts` (F1: `isNull(tecnico.deactivatedAt)` in the technician query).
- Tests: `policy.test.ts`, `route-guards.test.ts` (`/tablero`, `/api/board`), `app/api/board/route.test.ts`, `app/tablero/page.test.tsx`, `board/WorkshopBoard.test.tsx` (includes poller URL and the insecure-context / types-only-import source test), `layout/nav-items.test.ts` (new test + totals 5->6, 11->12 + CRM list), `components/app-sidebar.test.tsx` (icon), e2e: `board-routes.e2e.test.ts` (+4 tests: técnico sees an unassigned order via page and route, pantalla denied, sentinel clean, unauthenticated; describe renamed `board routes (E2E)`) and `board.e2e.test.ts` (+1: F1).

### Behaviour notes / deviations
- RED seen first for all unit tests (policy x5, nav, route-guards, sidebar icon; page/route/component failed to resolve) and for F1 (deactivated technician returned). The 4 new routes e2e were written after the production code, so their RED is the mutation below, not a pre-code failure.
- The page and nav test fixtures that counted items were updated (técnico 5->6, admin 11->12).
- Cells of 7 columns at `grid-cols-7` with `text-lg`/`text-2xl`: legibility on the TV is a browser check (4.8), not proven.
- `/tablero` shares WU3's chrome-less layout, so a técnico or admin reaching it from the sidebar has no sidebar on that page (no way back except the browser). Not changed here; flag for 4.8.
- The vite plugin rewrites a literal `new URL("File.tsx", import.meta.url)` into an asset URL; the source test uses a variable (as CustomerBoard.test does via it.each).

### Mutation-verify (fix reverted, named test red, restored)
- `pantalla` granted `board.read`: "Pantalla is denied the full board: board.read is for administrador, jefe_taller and tecnico, never pantalla", "Matrix row: pantalla is true for board.customer ...", route "Pantalla is denied the full board: 403 JSON, and nothing is queried", page "Pantalla is denied the full board: PermissionDenied, and the query seam is never called".
- `can()` removed from `/api/board`: route "Pantalla is denied the full board: 403 JSON, and nothing is queried". `can()` removed from the page: page "Pantalla is denied the full board: PermissionDenied, ...".
- Route scoped to the técnico's own orders (rows without a technician dropped): e2e "Técnico reads the full board: /tablero and GET /api/board show an order nobody assigned to them".
- `appointmentAt` removed from the booked row (`shape.ts`): "Booked order without a vehicle: Sin vehículo, Agendada, technician and appointment, no throw" and "appointmentAt only while booked" (WU2 shape tests); component: appointment render removed -> "Booked order without a vehicle shows Sin vehículo, Agendada, the technician and the appointment time in Panama".
- "Tablero" handed to pantalla (action `board.customer`): "Nav link by role: Tablero (/tablero) for administrador, jefe_taller and técnico, and for no other role" (+ the técnico total).
- Component: age from the live clock -> "shows technicians and ages computed from generatedAt, not the live clock"; hold reason on any status -> "shows the hold reason only on an on_hold row"; appointment on any status -> "non-booked rows show no appointment time"; appointment formatted in UTC -> the Panama booked test; wrong poll URL -> "polls /api/board and shows the new rows"; icon unmapped -> "renders the `board` key as LayoutDashboard, not the Package fallback".
- F1 (`isNull(tecnico.deactivatedAt)` reverted): e2e "F1: a deactivated technician assigned to an order does not appear on the board, the active one does".
- NOT mutated: the `ROUTE_GUARDS` entries for the two new keys (same mechanism mutation-verified in WU3), the sentinel-clean e2e (the privacy property lives in WU2's mapper, mutated there), the unauthenticated e2e (same `proxy.ts` path as WU3's).

### Gates
- `npm test`: 233 files, 3680 tests passed. `npx tsc --noEmit`: clean. `npm run lint`: 0 errors, 13 warnings.
- e2e, fresh `dforce_e2e`, full suite: 26 files, 337 tests passed (board-routes.e2e: 10, board.e2e: 7).

### Size
- vs `feat/workshop-status-board-wu3-e2e`, untracked included, openspec excluded: 488 added / 19 deleted = 507 changed. e2e files are 69 added / 7 deleted of that; without them 419 added / 12 deleted = 431. Over 400 either way; splitting off the e2e (and still ~31 over) is the orchestrator's call.

### Unchecked
- No browser check (4.8): RSC serialization of the page props, hydration of the Panama-formatted appointment (ICU differences between Node and the browser are possible), 7-column layout and TV legibility on a real screen, the chrome-less layout for staff.
- `formatDateTime` renders `es-PA` date + time with seconds; the exact look was not reviewed against a mockup.
- Engram `mem_save` of apply-progress NOT done (no memory tool in this executor); file store only.

## Fix round (browser checks)

Branch `feat/workshop-status-board-fixes`. RED seen first for every fix; mutation-verified by name.

| # | Fix | Test | Mutation result |
|---|---|---|---|
| 1 | `formatBoardTime` (`board/format.ts`, parts of `Intl.DateTimeFormat` Panama, h23) used by `WorkshopBoard` | format.test "renders a known instant in Panama time (UTC-5), exact string", "crosses the Panama day boundary", "is digits and separators only"; WorkshopBoard "Booked order without a vehicle ..." asserts `27/10 10:00` | UTC zone -> first two red; `hour12` -> exact-string red; `toLocaleString` back in component -> Booked order test red |
| 2 | `useBoardSnapshot` returns `now` (10 s ticker only while `failedAt !== null`); `StaleBanner({lastOkAt, now})` | useBoardSnapshot "exposes a live `now` ...", "a success clears `now` ...", "unmounting during a failure clears the ticker too"; CustomerBoard "the banner appears 70 s after the last GOOD snapshot ... (59.6 s)"; StaleBanner tests | ticker no-op -> the 59.6 s test and "exposes a live now" red; clearInterval removed -> the two timer-count tests red; banner threshold 2 -> "reads exactly ... hace 1 min" red |
| 3 | `MAX_ROWS` 8 | CustomerBoard "clips a long column with `+N más`" | back to 12 -> red |
| 4 | `proxy.ts` `unavailable()` on a throwing validator, logged with `console.error` | proxy.test "session validation throws (database down)": API 503 JSON, page 503 HTML + refresh meta + no redirect/cookie, logs | `denyAccess` instead -> API and page tests red |
| 5 | `(app)/layout.tsx` redirects `pantalla` | layout.test "redirects a pantalla session to its landing ..." | line removed -> red |
| 6 | `overflow-x-auto` wrapper + `min-w-[72rem]` grid | WorkshopBoard "the 7-column grid scrolls inside its own container ..." | wrapper plain div -> red |

Also: GGA (a) and (b) done. Errors from the proxy go to `console.error` only; the repo's other server catch blocks swallow errors and Sentry is wired through `instrumentation.ts` `onRequestError` (uncaught only), so this is not sent to Sentry.

### Unchecked
- Nothing re-verified in a browser: hydration, the 1080 px height at 8 rows (row height ~112 px is the orchestrator's measurement, not mine), the 390 px phone, the 503 page on a real DB outage, the redirect for `pantalla` on a real `/inventory`.
- `min-w-[72rem]` (1152 px) is my choice for the grid; a TV is wider so it is a no-op there.
- e2e (g) in `pantalla-role.e2e.test.ts` calls pages as functions, so it still passes; its wording was not changed.

## Browser checks (4.8), 2026-10-26

Run at http://192.168.0.7:3000 against a copy of the dev DB with 20 extra active orders. First pass found six defects (hydration mismatch on the booked time, late stale banner, customer view taller than 1080 px, dead page when the DB is down on first load, pantalla seeing the app shell, sideways page scroll on a phone); all fixed in 4.11–4.17 and re-checked:

- `/tablero` 3 fresh loads as jefe + 1 as tecnico: no hydration or RSC errors; booked rows read `05/11 10:30`.
- Stale banner: `hace 1 min` at 70.1 s after the last good snapshot, `hace 2 min` at 129.9 s; rows stay; clears 11.2 s after the server returns, no reload.
- `/tablero/clientes` at 1920x1080: scrollHeight 1080, 8 rows + `+7 más`.
- DB down on first load: HTTP 503 `Sin conexión, reintentando…`, API 503 JSON; recovers on its own 25.8 s after the DB returns. With a board already open: rows stay, banner at 70.2 s, clears 9.6 s after restore.
- pantalla: `/inventory`, `/service-orders`, `/users`, `/account` → 307 to `/tablero/clientes`, no sidebar; `/tablero` PermissionDenied; `/api/board` and `/api/users` 403.
- Phone 390x844: page scrollWidth 390; the board scrolls inside its own container.
- 401: a revoked pantalla session lands on `/login` at the next poll (30.6 s).
- Customer view privacy: none of 59 names, phones and emails of the active orders customers in the HTML.
- Técnico sees every order (unassigned included), no controls.

Not checked by the agent: a real TV at room distance, a second machine, and the pantalla password login / forced password change (no passwords are typed by the agent; owner to check).
