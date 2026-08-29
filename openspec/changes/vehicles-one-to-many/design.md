# Design: Vehicles one-to-many (C3)

## Technical Approach

A `vehiculo` child table replaces `cliente`'s four inline columns, delivered as **expand → switch → contract**
across three chained PRs. The proposal put the column drop in slice 1; that cannot compile, because
`queries.ts`, `service.ts`, `validation.ts`, `CustomerForm.tsx` and both pages still read
`cliente.vehiclePlate`. Splitting the migration in two moves the only irreversible step to the **last**
slice and makes slices 1 and 2 plain reverts.

The collection write path is the real work. It is made testable by extracting one **pure** reconcile
planner; the transaction is then a thin executor around a plan that unit tests can exercise with no
database.

## Architecture Decisions

### D1 — Child table, not JSONB

**Choice**: `vehiculo` table, `text` UUID PK (`crypto.randomUUID()`), `cliente_id` FK `on delete cascade`.
**Rejected**: JSONB array on `cliente`.
**Rationale**: ADR-7 already killed a JSONB parts blob for the structurally identical
`orden_servicio_item` problem ("loses which orders used part X"), and C4 needs `vehiculo.id` as an FK
target — a blob cannot be one. Cascade (not `restrict` like `orden_servicio`) because vehicles have no
independent lifecycle and it keeps E2E cleanup a single delete by `cliente` id. C4's
`orden_servicio.vehiculo_id` must use `restrict`.

### D2 — Two migrations, expand then contract

| | Migration | Slice | Reversible |
|---|---|---|---|
| Expand | `0013` — `CREATE TABLE vehiculo` + `vehiculo_plate_idx` + `INSERT…SELECT` backfill of rows where `vehicle_plate IS NOT NULL` | 1 | Yes — drop the table |
| Contract | `0014` — `DROP` the four `cliente` columns + `cliente_plate_idx` | 3 | No |

**Rejected**: one migration in slice 1. It leaves `tsc` red and the app broken at the end of a slice.
**Rationale**: standard expand/contract. Between slices 2 and 3 the four columns are dead but still
present — a branch-level transient only: in the feature-branch-chain only the tracker merges to `main`,
so no intermediate state reaches production. Backfill is `1` row today (`orden_servicio` = 0 rows,
0 rows violate R17), eyeball-verifiable, and never cheaper than now.

### D3 — Soft delete copies `users.deactivated_at`, it does not invent a flag

**Choice**: `vehiculo.deactivated_at timestamptz NULL` — `NULL` = active. Reversible by setting it back
to `NULL`.
**Rejected**: `active boolean NOT NULL DEFAULT true`.
**Rationale**: the brief calls this the project's first soft-delete flag. It is the first on the
*customer* side, but `users.deactivated_at` already ships the whole shape: `isUserActive()`
(`auth/session.ts:58`), `isNull(users.deactivatedAt)` filters plus an `includeInactive` parameter
(`account/queries.ts:57`), `deactivateUser`/`reactivateUser`, and a `showInactive` UI toggle. A boolean
would be a second, incompatible convention and would throw away *when* the vehicle was removed. The
later enable/disable-customers change then copies one shape, not a choice between two.

**Filtering — the failure mode is forgetting one path.** Two containments, both cheap:

1. **One owner.** `vehiculo` is imported from `schema.ts` by `src/modules/customers/vehicles.ts` and
   nowhere else. Every read is one of `activeVehiculoFilter()`, `platesSubquery()`,
   `listVehiculosByCliente()`. Pages, picker and API get arrays, never a query builder.
2. **The filter is asserted in rendered SQL, not by review.** `queries.test.ts` already compiles
   fragments with `new PgDialect().sqlToQuery(...)` (line 11). The `EXISTS` test asserts the literal
   `"vehiculo"."deactivated_at" is null` substring, so dropping the filter fails a DB-free unit test.

### D4 — `EXISTS` for the predicate, correlated `array_agg` for the display

```sql
exists (select 1 from "vehiculo"
        where "vehiculo"."cliente_id" = "cliente"."id"
          and "vehiculo"."deactivated_at" is null
          and unaccent("vehiculo"."plate") ilike unaccent($1))
```

**Rejected**: `LEFT JOIN` — duplicates the `cliente` row per matching vehicle and forces
`DISTINCT`/`GROUP BY` on `listClientes`/`countClientes`.
**Rationale**: `EXISTS` leaves both queries structurally identical; `CustomerPicker` and
`customers/page.tsx` consume `buildClienteSearchWhere` as an opaque WHERE fragment and inherit it free.
`unaccentIlike` and both-sides `unaccent()` (PR #44) are preserved verbatim — the helper is reused, not
re-implemented, and now takes `vehiculo.plate` as its column.

`ClienteListItem.vehiclePlate` becomes `plates: string[]`, filled by a correlated subselect in the same
statement — no N+1, no second round trip, no grouping:

```sql
(select coalesce(array_agg(v."plate" order by v."created_at"), '{}')
   from "vehiculo" v where v."cliente_id" = "cliente"."id" and v."deactivated_at" is null)
```

`getClienteById` adds `vehicles: Vehiculo[]` via one more `select` inside its existing `queryFn` (it
already runs two).

### D5 — Vehicles are a reconcile, not a merge

`service.ts` has zero vehicle-column references but owns the write path, and
`validateClienteInput({ ...current.cliente, ...patch })` (line 81) is a scalar merge. Design:

| Concern | Decision |
|---|---|
| Patch shape | `vehicles?: VehiculoInput[]` sits **beside** the scalars, never inside the spread. `validateClienteInput` loses all four vehicle fields, so line 81 keeps working unchanged and R16's "persist only the changed field" keeps meaning something for scalars |
| `vehicles` omitted | Collection untouched. This is what preserves R16's scenario |
| `vehicles: []` | Explicit: deactivate every active vehicle |
| Identify update vs insert | Element **with** `id` = update; **without** `id` = insert. Plates are never the key — they are editable and not unique |
| Client omits an existing vehicle | Soft delete: `deactivated_at = now()` |
| `id` not among the customer's active vehicles | `ClienteValidationError` — never a silent insert. Trust boundary: an id copied from another customer must not become writable |
| Re-adding a removed plate | New row. Deliberately does not resurrect the old one (`ponytail:` ceiling — revive-on-match if history continuity is ever asked for) |
| Atomicity | One `db.transaction`, following `account/service.ts`'s `deps.database?: { transaction }` + `TxLike` seam. Drizzle builders on `tx`, **not** hand-written `SET` SQL — `applyUserPatchTx` only used raw SQL for the `::role` enum cast, which does not apply here |

```ts
export type VehiculoInput = { id?: string; plate: string; make?: string; model?: string; year?: number };
export type VehiculoPlan = { inserts: VehiculoInput[]; updates: VehiculoInput[]; deactivate: string[] };
export function planVehiculoReconcile(existing: Vehiculo[], incoming: VehiculoInput[] | undefined): VehiculoPlan;
```

`planVehiculoReconcile` is pure and DB-free: the hardest logic in this change becomes ordinary unit
tests, and the transaction is a dumb executor of its three lists.

### D6 — R17 relocates and simplifies

`validateVehiculoInput` (in `customers/validation.ts`) requires `plate` on **every** vehicle; make,
model and year stay optional. The old conditional "plate required if any other vehicle field is
present" disappears because a vehicle row without a plate has no reason to exist.

## Data Flow

    CustomerForm ──{name, phone, …, vehicles[]}──▶ /api/customers[/id]
                                                        │
                                            service.createCliente/updateCliente
                                     ┌──────────────────┴──────────────────┐
                          validateClienteInput (scalars)      validateVehiculoInput (per element)
                                     └──────────────────┬──────────────────┘
                                              planVehiculoReconcile (pure)
                                                        │
                                        db.transaction ─┴─ cliente row + vehiculo insert/update/deactivate

    search ─▶ buildClienteSearchWhere ─▶ EXISTS(vehiculo …) ─▶ listClientes/countClientes
                                                              └─ plates[] via correlated array_agg
                                                                 └─ page.tsx, CustomerPicker.identifierFor

## File Changes

| File | Slice | Action | Description |
|---|---|---|---|
| `src/shared/db/schema.ts` (+ `.test.ts`) | 1 | Modify | `vehiculo` table + `Vehiculo` type; `cliente` columns still present |
| `src/shared/db/migrations/0013_*.sql` | 1 | Create | Create table, index, `INSERT…SELECT` backfill |
| `src/modules/customers/vehicles.ts` (+ `.test.ts`) | 2 | Create | Sole owner of `vehiculo` reads/writes; `planVehiculoReconcile`, `activeVehiculoFilter`, `platesSubquery` |
| `src/modules/customers/validation.ts` (+ `.test.ts`) | 2 | Modify | Drop 4 fields from `ClienteInput`; add `validateVehiculoInput` |
| `src/modules/customers/queries.ts` (+ `.test.ts`) | 2 | Modify | `EXISTS` branch; `plates: string[]`; `ClienteDetail.vehicles` |
| `src/modules/customers/service.ts` (+ `.test.ts`) | 2 | Modify | Transactional create/update over the plan |
| `src/app/api/customers/{route,[id]/route}.ts` (+ tests) | 2 | Modify | Pass `vehicles` through; unchanged error mapping |
| `src/e2e/full-flow.e2e.test.ts` | 2 | Modify | New `vehicle search (E2E)` describe |
| `src/modules/customers/CustomerForm.tsx` (+ `.test.tsx`) | 3 | Modify | Repeating-group UI (add/remove rows), Spanish copy |
| `src/app/(app)/customers/{page,[id]/page}.tsx` | 3 | Modify | `plates.join(", ")`; per-vehicle detail block |
| `src/modules/service-orders/CustomerPicker.tsx` | 3 | Modify | One line: `identifierFor(customer, customer.plates)` |
| `reminders/{job,schedule}.test.ts`, `ServiceOrderForm.test.tsx`, `CustomerPicker.test.tsx` | 3 | Modify | Fixtures only |
| `src/shared/db/migrations/0014_*.sql` | 3 | Create | Drop the four columns + `cliente_plate_idx` |
| `src/shared/db/migrations/meta/*.json` | 1, 3 | Generated | Never hand-edited |

## Testing Strategy

Strict TDD: RED first in every unit below. `service.test.ts`/`queries.test.ts` inject the query seam, so
a green `npm test` **proves zero real-SQL coverage** — the split below is not optional bookkeeping.

| Layer | Provable without a database | How |
|---|---|---|
| Unit | `validateVehiculoInput`; `validateClienteInput` no longer knows vehicle fields | Pure functions |
| Unit | Every reconcile rule in D5, including the foreign-`id` rejection | `planVehiculoReconcile` is pure — written and made to fail **before** the transaction exists |
| Unit | The `EXISTS` fragment's shape: `unaccent()` on both sides, `deactivated_at is null` present | `new PgDialect().sqlToQuery()`, extending `queries.test.ts:8` |
| Unit | Transaction ordering and that a thrown insert aborts the whole write | Fake `deps.database.transaction`, as `account/service.test.ts` does |
| Component | Add/remove vehicle rows, Spanish labels, empty state | `.test.tsx` → jsdom project |
| **E2E (live DB only)** | second/third plate matches, not just the first | new `vehicle search (E2E)` block |
| E2E | zero-vehicle customer still matches on name and phone | idem |
| E2E | soft-deleted vehicle vanishes from search while its customer stays findable by name | idem |
| E2E | `plates` really comes back as a multi-element array (`array_agg`) | idem |
| **Manual gate** | 0013's backfill | Live smoke test — see below |

New E2E block follows `customer search (E2E)` exactly: `execSync("npx drizzle-kit migrate")` in
`beforeAll`, seed via captured ids, `afterAll` deletes those `cliente` ids (vehicles cascade).

The backfill cannot be an E2E assertion: `beforeAll` migrates before it can seed, so no row ever exists
in the pre-migration shape. It is a manual gate on slice 1 instead — 1 row, verifiable by eye.

**Running the E2E** — `vitest.e2e.config.ts` deliberately does not override `DATABASE_URL` and
`npm run test:e2e` does not load `.env` (which points at the DEV database). Export `DATABASE_URL`
explicitly at the throwaway container on port **5433**, and recreate the database per run: the catalog
describe seeds users it never cleans up.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or
process-integration boundary. The E2E's pre-existing `execSync("npx drizzle-kit migrate")` is unchanged
test infrastructure with no new input.

## Migration / Rollout

| Slice | Authored lines (est.) | Budget 800 | Independently revertible |
|---|---|---|---|
| 1 — schema + 0013 + schema.test | 150–200 | Low | Yes — drop table; `cliente` columns untouched |
| 2 — validation/vehicles/queries/service/API + E2E | 450–550 | Medium | Yes — code-only revert, 0013 stays harmless |
| 3 — form/pages/picker/fixtures + 0014 | 400–500 | Medium | **No** — 0014 drops columns; down-migration copies back one vehicle per customer, lossy once a second exists |

Roll back before slice 3 ships, or accept the loss. Slice 1 must not merge to `main` ahead of the
chain: `0013` alone is inert but pointless without slice 2.

## Open Questions

- [ ] Proposal question round 1–5 are still unanswered by the owner; this design assumes each stated
      assumption holds, **except** #2 (hard delete), which the session brief overrode to soft delete.
- [ ] Does the customer list need a "show removed vehicles" toggle like `UsersTable`'s `showInactive`?
      Assumed no for C3 — removed vehicles are simply invisible.
