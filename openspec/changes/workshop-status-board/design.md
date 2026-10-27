# Design: Workshop Status Board

## Technical Approach

Two read-only views under a top-level `src/app/tablero/` segment (outside the `(app)` shell), each server-rendered on first paint and then kept live by one client poller that calls a matching guarded GET route. A new `src/modules/board/` owns the queries (never touching `cliente`) and pure, field-by-field mappers. A new `pantalla` role reaches only the customer view, lands there, and gets a 180-day session. Delivered as four chained PRs off the tracker `feat/workshop-status-board`.

## Architecture Decisions

**D1 — Role `pantalla` via migration 0035.** `0035_role_pantalla.sql` is the single line `ALTER TYPE "public"."role" ADD VALUE 'pantalla';`. `0028_enum_jefe_ready.sql:2` is the precedent. Drizzle's `migrate()` runs every pending file in ONE transaction (`schema.ts:577-580`, `0034_…sql:1`), and Postgres rejects using a value added in the same transaction. So 0035 contains nothing else, and no later migration in the chain uses `'pantalla'` as a literal unless it casts with `::text`. `roleEnum` (`schema.ts:13`) appends `"pantalla"`. `ROLES`/`ROLE_LABELS` (`roles.ts:1,5`) get `pantalla: "Pantalla"`. `UserForm.tsx:303` builds its select from `ROLE_LABELS`, so the role becomes assignable without other changes. `EDITABLE` (`edit-policy.ts:37`) gets an all-false row, which `Record<Role,…>` requires. The copy at `account/service.ts:195,404` becomes "El rol debe ser técnico, jefe de taller, administrador o pantalla.". Rejected: a boolean `is_kiosk` on `users`, which would bypass the `MATRIX`/`can()` system.

**D2 — Actions land with their routes.** `board.customer` (WU3) and `board.read` (WU4) are added to `ACTIONS` (`policy.ts:3`) together with the route that evaluates them. If they landed earlier, the "every Action is reachable" test (`route-guards.test.ts:204-224`) would fail or need a temporary exemption. Grants:

| Role | board.read | board.customer | other grants |
|---|---|---|---|
| administrador | true | true | unchanged |
| jefe_taller | true | true | unchanged |
| tecnico | true (proposal scope decision) | false | unchanged |
| pantalla | false | true | all false, including `account.self` and `users.manage` |

WU1 adds the `pantalla` row using only the actions that exist then. `can()` (`policy.ts:144`) already fails closed.

**D3 — Session TTL per role.** The signature becomes `issueSession(userId, role)`. Its only caller is `authenticateUser` (`authenticate.ts:69`), which already holds `user.role`. A pure `sessionTtlMs(role)` returns 180 days for `pantalla` and 7 days otherwise (`session.ts:41`). Both cookie setters already set `expires: result.expiresAt` (`actions.ts:33`, `api/login/route.ts:34`), so the cookie follows with no edit. Update the call expectation at `authenticate.test.ts:76`. Rejected: sliding expiry, because it adds a DB write and a cookie re-set on every proxied request.

**D4 — One landing helper.** `src/modules/auth/landing.ts` exports `landingPathFor(role)`: `pantalla` → `/tablero/clientes`, every other role → `/inventory`. Two callers use it: `app/page.tsx:7` (via `requireSessionFromHeaders`) and `loginAction` (`actions.ts:37`, `result.role`). `ForcedPasswordChangeForm.tsx:89` already pushes `/`, which now resolves through the same helper, so that file stays unchanged. `PermissionDenied`'s "Volver al inicio" (`PermissionDenied.tsx:25`) also goes through `/`.

**D5 — Routes.** Two GET routes, one per view: `src/app/api/board/route.ts` (`board.read`) and `src/app/api/board/clientes/route.ts` (`board.customer`). A single route switching on `?view=` was rejected: one file would evaluate both actions, and the textual cross-reference (`route-guards.test.ts:308-310`) could no longer show which action gates which view. Pages: `src/app/tablero/page.tsx` (`board.read`) and `src/app/tablero/clientes/page.tsx` (`board.customer`), each following `requireSessionFromHeaders` → `can()` → `PermissionDenied` (`metrics/page.tsx:25-28`). `filePathToUrl` (`route-guards.test.ts:143`) needs no change. New `ROUTE_GUARDS` keys: `/tablero`, `/tablero/clientes`, `/api/board`, `/api/board/clientes`. `proxy.ts:20-25` already returns 401 JSON for `/api/*` and a redirect for pages.

**D6 — Data layer: privacy by construction, no N+1.** `board/queries.ts` makes three queries per snapshot:
1. **Orders.** `ordenServicio` left-joined to `vehiculo`. `vehiculoId` is null for `booked` (`schema.ts:548`), so the join must be a left join. Status filter: in the backlog set (`BACKLOG_STATUSES`, `metrics/shape.ts:7`), or `done` with `completedAt >= start of the workshop day`. The customer variant uses the same set minus `booked`. Selected columns, named explicitly: id, status, esperaMotivo, updatedAt, plate, make, model. Ordered by `createdAt`.
2. **Technicians.** `orden_tecnico ⨝ tecnico` filtered with `inArray(ordenId, ids)`, returning `(ordenId, nombre)`. This is full board only.
3. **Status history.** `orden_estado_historial`: `max(changedAt)` grouped by `ordenId`, filtered with `inArray`.

These are batched `inArray` queries, not correlated `sql` subqueries inside `.select()`. The `platesSubquery` qualifier-elision trap (`vehicles.ts:160-166`) does not apply to them.

**Workshop day.** `toWorkshopDateKey(now)` (`datetime.ts:64`) converted to the bound `(${key}::timestamp AT TIME ZONE 'America/Panama')`. This mirrors `metrics/queries.ts:21`. `now` is injectable.

**Time in status.** The latest history `changedAt`, falling back to `updatedAt`, because 0033 did not backfill history. This is approximate for older orders.

**Privacy.** The file never imports `cliente`. A source-text test (`board/queries.privacy.test.ts`) enforces this.

**D7 — Pure mappers, names every field.** `board/shape.ts` provides `toBoardSnapshot(rows, techs, since, now)` and `toCustomerSnapshot(rows, now)`. They build objects literal-by-literal and never spread a row (the `snapshot.ts:5-9` rule). The customer status comes from `CUSTOMER_STATUS`, which becomes an `export` from `portal-sync/snapshot.ts:22`. This is safe because the mappers run only on the server: `snapshot.ts` imports `node:crypto` (line 11) and must never reach a client bundle, so the poller only receives labels that are already mapped. Customer rows carry no order id; the React key is the row index. All instants travel as ISO strings, both across the RSC boundary and in JSON. A sentinel-poison test fills every forbidden field with `"__LEAK__"` and asserts that `JSON.stringify(output)` does not contain it.

**D8 — Poller.** `board/useBoardSnapshot.ts` (client) takes `(url, initial)` and runs `setInterval` every 30 s with `fetch(url, { cache: "no-store" })`. Outcomes:
- 2xx: replace the snapshot and record `lastOkAt`.
- 401: `location.assign("/login")`.
- 403: `location.assign("/")`. The user's role changed, so the landing decides where to go.
- Network error or any other status: keep the last snapshot and set `stale`.

Polling does not pause when `document.hidden` is true. A TV is always visible, and one small GET every 30 s on a personal tab costs nothing. `usePollWhileActive` (`usePollWhileActive.ts:16`) is not reused: it uses `router.refresh()`, which shows no staleness and leaves a dead page on a 500. `StaleBanner` reads "Sin conexión · actualizado hace N min". Its minutes are computed on the client and it renders only after the first failed poll, so there is no hydration mismatch. Ages ("hace 12 min", "3 h", "2 d", from the pure `formatAge`) are computed against `snapshot.generatedAt`, never the live clock, so the server and client renders are identical.

**D9 — First-paint failure.** `src/app/tablero/error.tsx` (client) shows "Sin conexión, reintentando…" and calls `window.location.reload()` after 60 s, so a TV never stays dead. `reset()` was rejected: it does not reliably refetch a server segment. `proxy.ts` now catches a session-validation error (fix round): API routes answer 503 JSON `{ "error": "Service unavailable" }`, pages a 503 HTML page with `<meta http-equiv="refresh" content="30">`; a DB error is never treated as "no session".

**D10 — TV styling.** `src/app/tablero/layout.tsx` is a chrome-less `<main className="min-h-dvh p-6 text-xl">`. The full board uses one column per status in a fixed status order, with empty columns kept, because it replaces a whiteboard. The customer board uses three columns (Recibida / En proceso / Terminada). Status badges use `StatusBadge` with a `className` (`text-base px-3 py-1`), which the component documents as its sizing escape hatch (`StatusBadge.tsx:95-104`). A size variant would add height to every row in the app. Dark is inherited from `defaultTheme="dark"` (`layout.tsx:25`). There is no theme toggle because there is no shell.

**D11 — Nav.** `nav-items.ts:17` gets `{ href: "/tablero", label: "Tablero", icon: "board", action: "board.read" }` in `CRM_ITEMS`. The `NavIconKey` union (`:4`) gains `"board"`, and `app-sidebar.tsx:62`'s map gains a lucide `LayoutDashboard`.

## Data Flow

    TV / tab ──GET /tablero/clientes──▶ proxy (session) ──▶ page: can() → queries → shape ──▶ HTML + initial snapshot
        │                                                                                              │
        └── every 30 s: fetch /api/board/clientes ──▶ proxy ──▶ route: can() → queries → shape ──▶ JSON ┘
             401 → /login · 403 → / · error → keep snapshot + StaleBanner

## File Changes (by work unit)

| WU | Files (owner) | Est. lines |
|---|---|---|
| 1 Role/landing/TTL | `migrations/0035_role_pantalla.sql` + journal, `schema.ts`, `auth/{roles,policy,session,authenticate,actions,landing}.ts`, `app/page.tsx`, `service-orders/edit-policy.ts`, `account/service.ts` + tests | ~250 |
| 2 Data layer | `board/{queries,shape,format}.ts`, `portal-sync/snapshot.ts` (export), unit + sentinel + privacy tests, `e2e/board.e2e.test.ts` | ~320 |
| 3 Customer view | `board.customer` in `policy.ts`, `api/board/clientes/route.ts`, `tablero/{layout,error}.tsx`, `tablero/clientes/page.tsx`, `board/{useBoardSnapshot.ts,StaleBanner.tsx,CustomerBoard.tsx}`, `route-guards.test.ts` + tests | ~380 |
| 4 Full board | `board.read` in `policy.ts`, `api/board/route.ts`, `tablero/page.tsx`, `board/WorkshopBoard.tsx`, `layout/nav-items.ts`, `components/app-sidebar.tsx`, `route-guards.test.ts` + tests | ~350 |

The work units run in order. Each one owns its files; WU3 and WU4 touch `policy.ts` and `route-guards.test.ts` one after the other, never in parallel.

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit | `sessionTtlMs`, `landingPathFor`, MATRIX rows, `formatAge`, mappers | Pure tests; mutation-verify each one |
| Privacy | No `cliente` in `board/queries.ts`; sentinel poison on both mappers | Source-text test; `JSON.stringify` does not contain the sentinel |
| Component | Poller: 2xx replace, 401 assign, 403 assign, 500 keeps rows and shows the banner; board columns | jsdom with fake timers and a stubbed `fetch` that returns `Response` objects in the real shape |
| Route | Both GETs: 403 for the wrong role, 200 shape | Forged `x-user-role` headers |
| E2E (Postgres) | Status filter, done-today boundary in Panama, history fallback, technician batching, response contains no customer name or phone (seeded sentinel) | `e2e/board.e2e.test.ts` modelled on `metrics.e2e.test.ts`. The injected seam proves zero real SQL coverage, so this test is required |
| Browser | TV legibility, hydration, 401/expiry redirect, stale banner after unplugging the network | At the LAN IP, not localhost |

## Threat Matrix

N/A: the change adds no shell, subprocess, VCS/PR automation, executable-file classification or process-integration boundary. HTTP authorization is covered by D2, D5 and `ROUTE_GUARDS`.

## Migration / Rollout

0035 adds an enum value and cannot be reverted, because Postgres cannot drop enum values. Rollback means reverting the PRs and deactivating `pantalla` users, which revokes their sessions. Create the screen account at `/users`, then set up the kiosk at the OS level (wake, auto-start), as documented.

## Open Questions

- [ ] Customer-view copy: "Terminada" for `done` (non-blocking).
- [ ] Overflow: if more orders than fit on the TV, should a column clip or auto-scroll? The default is to clip with "+N más".
