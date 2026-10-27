# Exploration: workshop-status-board

Date: 2026-10-26. Owner decisions from the grill (2026-10-25/26) are final: a board replaces the physical whiteboard; it runs on fixed big screens (workshop and office) and on each person's own screen; two views — the full workshop board (administrador, jefe_taller) and a customer view with no name or phone (plate, vehicle, status only); one read-only `pantalla` account is used on every big screen and sees ONLY the customer view.

## Summary

- New role `pantalla` and two actions: `board.read` (full board: administrador, jefe_taller) and `board.customer` (customer view: pantalla, jefe_taller, administrador). Técnico access is an owner question.
- `usePollWhileActive` (`src/hooks/usePollWhileActive.ts:6,21,29`) only polls while a catalog upload is non-terminal; it is not reusable as is.
- Expired/revoked session during `router.refresh()`: the proxy redirects to `/login`, the response is HTML, and `fetch-server-response.js:128,133` does a hard navigation to `/login`, where the screen stays until someone logs in. A DB error in `validateSession` (`proxy.ts:50`, no try/catch) gives a 500 and a dead page with no poller. Traced from source, not verified in a browser.
- Kiosk session: long TTL for `pantalla` chosen in `issueSession` (90+ days); revocation stays immediate because sessions are DB-backed.
- Customer status labels: export `CUSTOMER_STATUS` from `src/modules/portal-sync/snapshot.ts:22` so the waiting-room screen and the QR portal say the same thing; hide `booked` and `cancelled`.
- Plate shown unmasked (it is printed on the car and is the customer's only handle).
- Pages at top-level `src/app/tablero/**`, outside the `(app)` shell.

## Current state

### RBAC

- Roles: `ROLES` in `src/modules/auth/roles.ts:1`, `ROLE_LABELS` at `:5`; DB `roleEnum` at `src/shared/db/schema.ts:13`. Precedent: `0028_enum_jefe_ready.sql` (`ALTER TYPE ... ADD VALUE`). A new enum value cannot be used in the same migrate transaction (`schema.ts:577,581`).
- `ACTIONS` (`policy.ts:3-37`) and `MATRIX: Record<Role, Grants>` (`policy.ts:43`) make a missing role row or action grant a tsc error. `can()` (`:144`) fails closed for an unknown role. `orderScope` (`service-orders/scope.ts:26`) gives a role without `readAll` only its own assignments, i.e. nothing for `pantalla`.
- `ROUTE_GUARDS` registry (`route-guards.test.ts:12-138`) requires an entry per `page.tsx`/`route.ts`, every action used, the action quoted in the file, and methods matching. `filePathToUrl` (`:143`) strips only `/(app)`, so top-level `src/app/tablero/**` needs no helper change.
- `src/proxy.ts`: matcher `:16`; no/invalid/expired/revoked session → `denyAccess` (`:45,58`), which is 401 JSON for `/api/*` and a redirect for pages (`:20-25`); `mustChangePassword` → `/change-password` or 403 (`:69-73`). No role-based path gate; authorization is `can()` in handlers and pages.
- Nav: `getNavGroups` filters by action (`modules/layout/nav-items.ts:60-90`); `NavIconKey` is a closed union (`:4`).
- Adding `pantalla` touches: `schema.ts:13` + migration, `roles.ts`, `policy.ts`, `edit-policy.ts:37` (`EDITABLE` needs an all-false row), Spanish copy listing the roles at `modules/account/service.ts:195,404`, tests (`roles.test.ts:5`, `policy.test.ts` ~`:85`, route guards). `UserForm.tsx:303` builds its select from `ROLE_LABELS`. `scripts/seed-user.mjs:16` stays as is (create the account through `/users`). Technician logic is gated on `=== "tecnico"`.
- Forced password change: `createUser` sets `mustChangePassword: true` (`account/service.ts:224`); `ForcedPasswordChangeForm.tsx:89` pushes `/`, and `src/app/page.tsx` and `loginAction` (`modules/auth/actions.ts:37`) both send every role to `/inventory`. Both must become role-aware or `pantalla` lands on a denied page. `account.self` should be false for `pantalla`. An admin password reset revokes all of the user's sessions (`account/service.ts:468-470`): every big screen dies at once — the intended kill switch.
- `authenticateUser` never calls `revokeOtherSessions` (`authenticate.ts:53-71`), so one account works on many screens.

### Data

- `BACKLOG_STATUSES` (`modules/metrics/shape.ts:7`) = booked, open, diagnosing, in_progress, on_hold, ready_for_review. `backlogByStatus` returns counts only.
- `ordenServicioListQuery` (`service-orders/queries.ts:156`) is paginated and joins `cliente`; the customer view needs a dedicated query that never selects `cliente` (privacy by construction).
- `orden_estado_historial` has no backfill (0033 only creates it), so time-in-status falls back to `updated_at`/`created_at` for older orders.
- Labels: `ORDER_STATUS_LABEL` (`statuses.ts:17`), `ESPERA_MOTIVO_LABEL` (`:29`); `StatusBadge` is `text-xs` on purpose, a TV needs a larger variant.

### Customer-view privacy

- Safe: plate, make, model, mapped status label.
- Never selected: `cliente.*`, order id, description, findings, recommendations, appointment, technicians, `espera_motivo`, and internal vehicle fields (`schema.ts:478-483`).
- Build rows by naming each field; copy the `portal-sync/snapshot.ts` whitelist and its sentinel-poison test.

### Layout

- Root layout (`src/app/layout.tsx`) is bare with a dark default theme; `(app)/layout.tsx` adds the sidebar. Board pages go in `src/app/tablero/page.tsx` and `src/app/tablero/clientes/page.tsx` with their own chrome-less layout, following `requireSessionFromHeaders` → `can()` → `PermissionDenied`.
- Insecure context: no `crypto.randomUUID`, `wakeLock`, service workers; keep the TV awake at OS/kiosk level.

## Options

### Statuses on the board

| Option | Shows | Notes |
|---|---|---|
| A | backlog only | misses "ready for pickup" |
| B | backlog + `done` completed today | recommended (full board) |
| C | everything | noisy |

Customer view: same minus `booked` and `cancelled`, plus `done` today.

### Refresh

1. Server render + `router.refresh()` poll — smallest, but dies on a 500 and has no staleness signal.
2. **Server first paint + client JSON poller** (recommended) — keeps the last good snapshot, shows "sin conexión, actualizado hace N min", sends a 401 to `/login`. Costs 1–2 GET routes with guards.
3. `<meta refresh>` — robust but flickers, and a 500 page has no refresh.

### Kiosk session

| Option | Pros | Cons |
|---|---|---|
| A. Long TTL for `pantalla` (recommended) | ~5 lines, cookie follows `expiresAt`, revocation instant | long-lived cookie, but it only grants the customer view |
| B. Sliding expiry | self-healing | DB write and cookie re-set on the hot auth path |
| C. Re-login | zero code | TV dies weekly — violates the requirement |

## Suggested work units

| WU | Content | Est. lines |
|---|---|---|
| 1 | `pantalla` role, migration, actions, matrix/EDITABLE rows, copy, role-aware landing, TTL | ~300 |
| 2 | Board data layer: queries, whitelist mapper, exported status map, sentinel test, time-in-status | ~300 |
| 3 | Customer view `/tablero/clientes` + poll route + resilient poller + guards | ~350 |
| 4 | Full board `/tablero` (technicians, hold reason, age), nav link, TV styling | ~350 |

## Risks and open questions

- Owner: should técnicos see the full board? (Recommend no; if yes, it must drop customer names.)
- Owner: "Terminada" as the waiting-room word for done.
- A TV showing the full board is logged in as jefe/admin: physical-access risk.
- Expiry redirect and the DB-error dead page need a browser check at the LAN IP.
- No test asserts rendered size; TV legibility is a browser check.
