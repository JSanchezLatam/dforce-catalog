# Exploration: service-order-workflow-states

SDD 1 of 4 from the 2026-10-25/26 grill (then: live board + customer view +
"Pantalla" role; agenda; technician hours). Scope here: the order state
machine, its history, and the schema relaxations the new states need.

## Owner decisions (input)

- **Agendada** (new, code `booked`): an appointment IS a service order.
  `vehiculo_id` and `categoria` are optional only while booked and required to
  leave it, enforced by a DB CHECK.
- **Recibida**: today's `open`, relabeled.
- **En diagnóstico** (new, `diagnosing`): automatic when the reception is saved
  with a technician, or when the jefe assigns the first technician to a
  Recibida order.
- **En progreso** (`in_progress`).
- **En espera** (new, `on_hold`): one state with a reason
  (`repuesto` | `aprobacion_cliente`); in/out only from En progreso; only
  jefe_taller and administrador.
- **Lista para revisión** (`ready_for_review`, derived by `applyReadiness`) →
  **Completada** (`done`). **Cancelada** unchanged. A no-show is a plain cancel.
- A status-history table powers a visual-only timer and the board later.
- Out of scope (agenda change): "Vencida", Reprogramar, quick customer create.

## Current state (verified file:line)

- `order_status` enum `open | in_progress | ready_for_review | done |
  cancelled` (`src/shared/db/schema.ts:239`); column NOT NULL default `open`
  (`schema.ts:539`).
- `ALLOWED_TRANSITIONS` (`transitions.ts:28-36`). Permission:
  `isTransitionPermitted = canAssign || (open → in_progress)`
  (`transitions.ts:67-69`); `canAssign` = `service-orders.assign`, admin + jefe
  only (`policy.ts:95,137`). So "En espera only jefe/admin" needs no new rule.
- `applyReadiness` (`readiness.ts:20-37`) writes status directly, no
  `assertTransition`, no history.
- `transitionOrder` (`service.ts:369-413`): row lock, assert, side effects
  (`completedAt`, parte-lista reset, reminders).
- Status writers: `createOrder` (`service.ts:201`, DB default),
  `transitionOrder` (`service.ts:387`), `applyReadiness` (`readiness.ts:34`),
  plus the two new auto-transitions.
- Auto-transition hooks: `createOrder` technician insert
  (`service.ts:217-221`); `assignTecnico` (`assignments.ts:52-85`, insert
  `:74-79`, under `lockOrderForMutation`).
- Migrations: PG 17 (`docker-compose.yml:38`, `standalone.ps1`); drizzle
  `migrate()` runs ALL pending migrations in ONE transaction. Precedents:
  `0028_enum_jefe_ready.sql` (`ADD VALUE … BEFORE`), `0029` comment on using a
  new value in the same transaction. Next migration: 0033.
- History patterns: `orden_servicio_correccion` (`schema.ts:606-618`),
  `cliente_consentimiento` (`schema.ts:405-420`).
- Dev DB (2026-10-26, read-only): `in_progress` 2, `done` 35, `cancelled` 4,
  `open` 0. No open-order backfill question exists.

## Blast radius

**Compile-forced** (exhaustive `Record<OrderStatus,…>`): `transitions.ts:28`,
`statuses.ts:16`, `edit-policy.ts` (`EDITABLE:37`, `PHOTOS_CHANGEABLE:60`,
`CLOSED:75`), `shared/ui/StatusBadge.tsx` (`BadgeStatus:5-22` already holds the
reminder's `scheduled` — hence `booked`), `portal-sync/snapshot.ts:19`.

**Silent** (need a deliberate edit + test): `service-orders/page.tsx:41`
`VALID_STATUS`; `ServiceOrderFilters.tsx:11-16` (hardcodes "Abierta";
`cancelled` already missing); metrics `shape.ts:7,21`, `queries.ts:71`,
`BacklogCounters.tsx:10-12`; `work-lines.ts:104-105` (`status: string`);
`parte-lista.ts:45`; `OrderWorkCard.tsx:159-160`; `workLineMode`
(`edit-policy.ts:110-115`); `queries.ts:68` sorts by enum declaration order
(place new values with BEFORE/AFTER); `OrderBulkStatusActions.tsx:104` and
`OrderStatusControls.tsx:33` (no reason input for `on_hold`). Many tests and
e2e files assert `open`/"Abierta".

**Reminders**: `appointment` at `appointmentAt − 24h` (`schedule.ts:89-91`);
`runReminder` has no status guard (`job.ts:222,238`), so an early arrival still
gets "tenés cita" → add fire-time guard "only while booked". `schedule.ts:35,92`
types `categoria` non-null.

**Portal** (separately deployed): `portal/src/contract.ts:12` accepts only
"Recibida" | "En proceso" | "Terminada" | "Cancelada"; `ingest/parse.ts`
rejects the WHOLE ingest on an unknown status or a missing `categoria`. So
`CUSTOMER_STATUS` maps diagnosing/on_hold → "En proceso", booked orders are
excluded from the snapshot (and the snapshot filters on `categoria`), and the
portal needs no deploy. `job.ts:97` already inner-joins `vehiculo`; the cast at
`job.ts:106` hides type drift.

**Nullability** (`schema.ts:536-542`): list + count `innerJoin(vehiculo)`
(`queries.ts:172-173,200-201`) must become `leftJoin` together (count parity);
detail `[id]/page.tsx:138,232,242`, print `print/page.tsx:115,246-267`,
`createOrder` validation (`service.ts:181-188`). A new write path is needed to
set vehicle + category on a booked order (PATCH whitelist
`[id]/route.ts:66-111` has neither). CHECK:
`status::text = 'booked' OR (vehiculo_id IS NOT NULL AND categoria IS NOT NULL)`
— `::text` avoids "unsafe use of new enum value" in the single migration
transaction; drizzle-kit output must be hand-edited. **Unverified: spike on a
throwaway DB.**

## Forks and recommendations

1. `open` → "Recibida": **relabel only** (portal already maps `open` →
   "Recibida", `snapshot.ts:20`); no enum rename.
2. Auto-transitions and history: **one service-layer `setStatus(tx, …)`
   helper** used by all writers (no DB trigger exists in the repo), plus an e2e
   per path asserting a history row.
3. En espera reason: **nullable `espera_motivo` enum column on the order** with
   `CHECK ((espera_motivo IS NOT NULL) = (status::text = 'on_hold'))`; history
   row copies it.

History table `orden_estado_historial`: id, orden_id (restrict), from_status
(null on creation), to_status, espera_motivo, changed_by (users, set null),
changed_at (default now), index (orden_id, changed_at).

Proposed transitions (to confirm):
- booked → received, cancelled
- received → diagnosing (auto), cancelled
- diagnosing → in_progress, cancelled
- in_progress → on_hold, done, cancelled
- on_hold → in_progress
- ready_for_review → in_progress, done, cancelled

## Open questions for the owner

1. Who moves En diagnóstico → En progreso?
2. Is Recibida → En progreso (skipping diagnóstico) still legal?
3. Can an order be cancelled from En espera / En diagnóstico (customer declines
   the quote)?
4. Per-role edits in the new states (findings in diagnóstico; parte lista /
   work lines while on_hold).
5. Synthetic first history row for existing orders, or timer starts at first
   new change?

## Size and split (400-line budget, chained)

| WU | Scope | ~Lines |
|---|---|---|
| 1 | Enum values, history table, `espera_motivo`, pure transitions/labels/edit-policy/badge, portal mapping | 350 |
| 2 | `setStatus` helper, auto-transitions, `transitionOrder` reason, readiness via helper, reminder guard, e2e | 400 |
| 3 | Nullable columns + CHECK, leftJoins, detail/print, create relax, set-vehicle-while-booked, snapshot filter | 350 |
| 4 | Status controls with reason, bulk, filters, `VALID_STATUS`, metrics, browser checks at LAN IP | 280 |

Drizzle `meta/*_snapshot.json` is generated and excluded from the budget.

## Spike result (2026-10-26, throwaway DB on PG 17)

Verified: in ONE transaction, `ALTER TYPE … ADD VALUE 'booked'` followed by
`CHECK (status::text = 'booked' OR (…))` succeeds, and the CHECK rejects a
non-booked row with null vehicle/category. The literal form
(`status <> 'diag'`) in the same transaction fails with
`unsafe use of new value "diag" of enum type order_status`. So the migration
must use `status::text` (hand-edit drizzle-kit output).
