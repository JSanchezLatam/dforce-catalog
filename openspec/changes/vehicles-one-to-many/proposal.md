# Proposal: Vehicles one-to-many (C3)

## Intent

A customer owns one vehicle today, hard-coded as four nullable columns on `cliente`
(`vehicle_make/model/year/plate`). Real workshop customers own several. This cashes the seam
ADR-6 (`archive/crm-workshop-management/design.md`) deliberately left open — "separate `vehiculo`
table now (YAGNI v1; **seam noted**)" — and gives C4 a stable FK target.

**Do it now because the migration is currently free.** Verified against the live DB: `cliente`
holds **1 row**, `orden_servicio` holds **0**, and **0 rows violate R17**. The backfill is
eyeball-verifiable today and never will be again. (The "364" in `customer-search-and-picker`
is the *Interfuerza ERP* census, not our row count; `queries.ts:30` repeats it in a comment.)

## Scope

### In Scope

- New `vehiculo` table: `id text` UUID PK, `cliente_id` FK, make/model/year/plate + `vehiculo_cliente_idx`
  (every read path filters on `cliente_id`; no index on bare `plate` — R19 searches `unaccent(plate) ILIKE`,
  which a plain btree cannot serve).
- Custom Drizzle migration: `INSERT…SELECT` backfill, then drop the four `cliente` columns and `cliente_plate_idx`.
- `buildClienteSearchWhere` plate branch → `EXISTS` subquery; `unaccentIlike` and both-sides `unaccent()` preserved verbatim.
- R17's plate rule relocated to a per-vehicle `validateVehiculoInput`.
- Transactional create/update of `cliente` + its vehicle collection.
- `CustomerForm` repeating-group UI; list/detail pages; `CustomerPicker` mapping; 18 files' fixtures.

### Out of Scope

- `orden_servicio.vehiculo_id`, service categories, per-vehicle history — **all C4**.
- Interfuerza sync (C6). The ERP carries no vehicle fields; vehicles stay purely local.
- The duplicate-phone rule and enable/disable customers.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `customer-management`: R16 (one inline vehicle → zero-or-more; list "plate" column becomes a joined list), R17 (cliente-level cross-field check → per-vehicle rule), R19 (plate match spans *any* of a customer's vehicles; `GET /api/customers` returns `plates: string[]`, not `vehiclePlate`), R18 **rationale only** (its text — "until multi-vehicle support exists" — is falsified on ship; the uniqueness rule itself is untouched).

## Approach

A real child table, not JSONB. ADR-7 already rejected a JSONB blob for the structurally identical
`orden_servicio_item` problem ("loses 'which orders used part X'"), and a blob cannot be C4's FK
target. C3's *only* obligation to C4 is the stable UUID PK, so C4 adds an ordinary nullable FK later
with zero coupling back here.

`EXISTS` over `LEFT JOIN`: a join duplicates the `cliente` row per matching vehicle and would force
`DISTINCT`/`GROUP BY`; `EXISTS` leaves `listClientes`/`countClientes` structurally untouched, and both
the picker and `customers/page.tsx` consume `buildClienteSearchWhere` as an opaque WHERE fragment,
so they inherit the fix for free. A customer with zero vehicles is "no match", not a NULL through `OR`.

Files live in `src/modules/customers/vehicles.ts`, **not** a new top-level module: vehicles have no
independent workflow, unlike `service-orders` or `reminders`.

## Affected Areas

| Area | Impact | Work |
|------|--------|------|
| `src/shared/db/schema.ts` (+ `.test.ts`), new migration | New/Modified | **Real** — hand-written backfill SQL |
| `src/modules/customers/service.ts` (+ `.test.ts`) | Modified | **Real, under-scoped in exploration** — see Risks |
| `src/modules/customers/CustomerForm.tsx` | Modified | **Real, largest jump** — 4 flat inputs → add/remove rows |
| `src/modules/customers/validation.ts` (+ `.test.ts`) | Modified | Real — new `validateVehiculoInput` |
| `src/modules/customers/queries.ts` (+ `.test.ts`) | Modified | Real — `EXISTS`, `ClienteListItem.plates` |
| `src/app/(app)/customers/{page,[id]/page}.tsx` | Modified | Small — joined-plate display |
| `src/modules/service-orders/CustomerPicker.tsx` | Modified | **One line** — `identifierFor` already takes `plates: string[]` (PR #44) |
| `src/e2e/full-flow.e2e.test.ts` | Modified | Real — new named check |
| `reminders/{job,schedule}.test.ts`, `ServiceOrderForm.test.tsx`, `CustomerPicker.test.tsx`, `api/customers{,/[id]}/route.test.ts` | Modified | **Mechanical** — fixture-only; the implementations have zero vehicle references |
| `src/shared/db/migrations/meta/*.json` | Untouched | Generated snapshots — never hand-edit |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| **`service.ts` is a collection-reconcile problem, not a patch merge.** It has *zero* vehicle-column references so it fell out of the 18-file grep, but `createCliente`/`updateCliente` do one single-table `insert`/`set`. Two tables now need a transaction, and `validateClienteInput({...current, ...patch})` (line 81) merges scalars — an array patch means add/update/delete reconcile | High | Design phase must specify the reconcile semantics and an omitted-`vehicles` = "leave untouched" rule; use the `applyUserPatchTx` transaction precedent |
| `CustomerForm` repeating group under-scoped in `tasks.md` | High | Its own work unit with its own `.test.tsx`; do not fold into the schema slice |
| Hand-written backfill SQL is the AGENTS.md blind spot — a green suite *proves* zero real-SQL coverage | Med | Live smoke test before merge; the 1-row/0-violation state makes it verifiable by eye |
| `EXISTS` matches only a customer's first plate | Med | Named E2E check below |
| ~~R19's live text is in the **unarchived** `openspec/changes/customer-search-and-picker/`~~ | **Closed** | That change is archived (`061cb2d`) and its deltas are consolidated into `openspec/specs/customer-management/spec.md`, which now holds R16–R19 plus access control. C3's delta stacks on a real baseline, not on a change folder. |
| R18's rationale silently left stale (rule untouched, so a delta review can skip it) | Med | Explicit line item in the spec delta |
| **Exceeds the 800-line review budget** (~1000–1100 changed lines) | High | Three slices delivered **sequentially to `main`**, each merged before the next branches: (1) schema + migration + backfill, (2) validation/queries/service + E2E, (3) `CustomerForm` + pages + picker + fixtures. Not a branch chain — expand/contract already makes each slice shippable alone, and GGA's `--pr-mode` always resolves to `main`, so a chained branch would re-review every ancestor commit. |

## Rollback Plan

Per-slice revert. **Slice 3 is the irreversible one, not slice 1.**

- **Slice 1** — clean. `DROP TABLE vehiculo;` and delete `0013`'s row from `drizzle.__drizzle_migrations`.
  `cliente` is untouched by this slice, so nothing is lost.
- **Slice 2** — ordinary code revert. `0013` stays harmless and inert with no readers.
- **Slice 3** — **irreversible past merge.** `0014` drops the four `cliente` columns. A down-migration
  can re-add them but can only copy back **one** vehicle per customer, so it is lossy the moment any
  customer has a second. Roll back before `0014` merges, or accept the loss.

## Dependencies

- ~~`customer-search-and-picker` (PR #44) must be archived first~~ — **done** (`061cb2d`); R19 now lives in `openspec/specs/customer-management/spec.md`.
- The `unaccent` extension (migration `0012`) — already shipped.

## Success Criteria

- [ ] The one existing `cliente` keeps its plate as exactly one `vehiculo` row after migration.
- [ ] A customer with three vehicles is findable by the **second and third** plate, not just the first.
- [ ] A customer with **zero** vehicles still matches on name and phone.
- [ ] Each vehicle independently rejects make/model/year without a plate (R17 relocated, not dropped).
- [ ] `orden_servicio` is byte-for-byte unchanged.
- [ ] `npm test` and `npx tsc --noEmit` clean; live-DB check run per AGENTS.md's coverage limit.

## Proposal question round

Could not ask interactively (sub-agent). These need the owner's answer before `sdd-spec`:

1. **R18's rationale is falsified, not merely stale.** Today it justifies phone-uniqueness with "a shared phone cannot yet represent two independent customer+vehicle records… until multi-vehicle support exists." C3 *is* that support — the stated reason to block evaporates. Assumption taken: the rule stays and gets a **new** rationale (one phone = one billable/contactable person; two cars now live under one `cliente`). Confirm, or does a shared phone now warrant two customers?
2. **Vehicle edit semantics.** ~~Assumption: hard delete now.~~ **ANSWERED by the owner: SOFT delete, reversible.** Consistent with the decision already taken for enable/disable of customers. It also protects the next change: an old service order must always be able to say which vehicle it was for, even once that vehicle is out of use. Note this makes it **the first soft-delete flag in the codebase** — enable/disable of customers is decided but not built — so its shape sets the precedent that change will copy.
3. **Zero-vehicle customers.** R16 becomes "zero or more". Is a customer with no vehicle a normal steady state, or a to-be-completed record the list should flag? **Answer: normal, no flag — and this is now evidence-backed rather than assumed.** The Interfuerza customer record carries no vehicle field of any kind (`RUC`, `DV`, `Credit_Term`, `Vendedor` — it is an accounting record), so the sync change will import 364 customers with zero vehicles each. A "to-be-completed" flag would fire on the entire imported base.
4. **Duplicate plates.** Should the same plate be rejected across two different customers (a sold car), or across the same customer's own list? Assumption: no uniqueness constraint at all in C3 — out of scope, and the DB has no such rule today.
5. **List column display.** R16's list view shows one plate cell. Assumption: reuse `CustomerPicker`'s shipped `plates.join(", ")` convention rather than invent a second one — no truncation, no "+2 more".
