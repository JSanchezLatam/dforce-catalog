# Design: Scalable Customer Search and Picker

## Technical Approach

Add `GET /api/customers` next to the existing `POST` in `src/app/api/customers/route.ts`, backed by
`listClientes`/`countClientes`. Replace the `<Select>` fed by a 1000-row preload with a debounced picker
that queries that route.

`src/modules/customers/queries.ts` **is** edited, in exactly one place: `buildClienteSearchWhere` now
folds accents (see "Decision: fold accents inside the shared predicate"). Earlier revisions of this
document and of `proposal.md` said it was untouched and that the customers list page was therefore out of
the blast radius; that is no longer true and both have been corrected rather than quietly reworded.

## Architecture Decisions

### Decision: `GET` in the existing route file, mirroring `api/users/route.ts`

**Choice**: `handleListClientes(request, deps)` + a thin `GET`, with `can(user, "customers.read")`
evaluated before the body/deps are touched, exactly as `handleListUsers` does (`api/users/route.ts:19-36`).
Response: `{ customers: ClienteListItem[]; total: number; relaxedFrom?: string }`.
**Alternatives**: a dedicated `/api/customers/search` route; a second search query in `queries.ts`.
**Rationale**: `ClienteListItem` already carries `vehiclePlate`, and `buildClienteSearchWhere` already
implements R19. A second route or predicate would be a second definition of "search" to keep in sync.

### Decision: fold accents inside the shared predicate, not in a picker-only copy

**Choice**: `buildClienteSearchWhere` builds `unaccent(column) ilike unaccent(pattern)` for all three of
`name`, `phone` and `vehicle_plate`, via a Drizzle `sql` template. Migration `0012_enable_unaccent.sql`
enables the extension (`CREATE EXTENSION IF NOT EXISTS unaccent` — trusted on PG 13+, so the app role can
create it, verified as the `dforce` user on PG 17.10).
**Problem**: `ilike` folds case but not accents. Verified against the real database:
`'María GONZÁLEZ' ilike '%maria%'` → `f`, `'María GONZÁLEZ' ilike '%maría%'` → `t`. The dataset is
Spanish — "María GONZÁLEZ" and "Pedro Díaz" are real rows — so staff typing `maria gonzalez` fell through
the exact pass, fell through the near-match pass, and were shown "Sin coincidencias para esa búsqueda."
above "Crear cliente nuevo". The change that exists to stop duplicate customers was inviting one, on the
most common input shape in the data.
**Alternatives**: fold accents in JS before building the pattern — **rejected**, it only normalises the
*term*, and the stored *column* keeps its accents, so the match still fails. A `name_unaccented` generated
column plus a backfill — rejected as a schema change and a second thing to keep in sync for 364 rows.
Wrapping only `name` — rejected; plates and phones are ASCII today but the asymmetry would be a trap the
first time it is not.
**Rationale**: both sides must be folded for the match to be symmetric (an unaccented term finds an
accented row *and* the accented term still works — the existing e2e case proves the second direction).
Putting it in the shared predicate keeps one definition of "search"; the cost is that it is genuinely
shared — see the consequence below.
**Consequence, stated not smuggled**: `buildClienteSearchWhere` also backs `src/app/(app)/customers/page.tsx`,
which `proposal.md` listed as explicitly unchanged. That page's search becomes accent-insensitive too. It
is an improvement and it is consistent — a customer found in the picker but not in the list would be worse
than either behaviour alone — but it is a behaviour change to a page this change said it would not touch,
and it is what makes the rollback no longer blast-radius-free.

### Decision: near matches = re-run the same query with a relaxed term

**Choice**: when the primary search returns zero rows, the handler calls `listClientes` a **second time**
with a term produced by a new pure module `src/modules/customers/near-match.ts`:
`relaxSearchTerm(term): string | null` — digits-only when the term is mostly digits (so `2345678`,
`234-5678` and `+507 234-5678` collapse to the same key), otherwise a shortened prefix; `null` when the
term is too short to relax, which suppresses the second query entirely. The response marks them with
`relaxedFrom`, so the client needs no second round-trip to know these are near matches.
**Alternatives**: `pg_trgm` + a GIN index — still out of scope, and note the accent-fold decision above
does *not* reopen it: `unaccent` is a one-line trusted extension with no index and no backfill, whereas
`pg_trgm` means a GIN index whose cost has to be measured first (and which `unaccent()` complicates —
see "Migration / Rollout"). Client-side fuzzy matching needs the whole table back, the thing this change
removes.
**Rationale**: zero new SQL, zero new dependency, and the relaxation logic is a pure function, which is
the only part of this feature that can be *proven* without a database.

### Decision: the picker owns the selected customer as an object, not an id

**Choice**: `CustomerPicker` holds `selectedCustomer: ServiceOrderCustomerOption | null`, seeded from an
optional `selectedCustomer` prop and set from the clicked row. It renders from that state, never from the
current result page, so changing the search term cannot blank the selection.
**Alternatives**: add `GET /api/customers/[id]` and re-fetch the preselected customer — **rejected**.
**Rationale**: rung 1 of the ladder — no endpoint is needed. In create mode the clicked row already
carries the data. It is true that no GET-by-id route exists; it is false that one is required. This
change adds **no** customer endpoint other than the list `GET`.

**Scope note, corrected**: an earlier draft of this section claimed the preselected customer "is passed
down as the `selectedCustomer` prop" from `service-orders/[id]/page.tsx`. That wiring does not exist and
this change does not build it. That page renders `OrderStatusControls` only — no `ServiceOrderForm`, no
picker — and `ServiceOrderForm` gates the picker behind `!isEdit` anyway, so no rendered path can blank a
selected customer today. The `selectedCustomer` prop is therefore a **component-level guarantee**, not a
reachable flow: whenever an edit path does grow a picker, the customer it is handed will render
regardless of the search term. What the page genuinely does have is `getClienteById(orden.clienteId)`
already called server-side, which is why that future wiring needs a prop and not an endpoint.

### Decision: the result row renders a list of plates, not one plate

**Choice**: `ServiceOrderCustomerOption` widens to
`Pick<Cliente, "id" | "name" | "phone" | "email" | "vehiclePlate" | "createdAt">` (= `ClienteListItem`,
so the route body maps straight through). The row component takes `plates: string[]`, today built as
`vehiclePlate ? [vehiclePlate] : []`. Identifier precedence when columns are null:
**plates → phone → email → "Registrado el {createdAt}"** — every fallback is a column the route already
returns, so a customer with neither phone nor plate is still never a bare, ambiguous name.
**Alternatives**: `plate: string | null` on the row; showing the raw id as fallback.
**Rationale**: vehicles become one-to-many in a later change; an array prop absorbs that with a mapping
edit instead of a row redesign. Staff cannot use a cuid as a disambiguator.

### Decision: reuse `CustomerFilters`' debounce, not its URL push

**Choice**: the 300 ms `debounceRef` idiom from `CustomerFilters.tsx:31-44`, but the debounced effect is
a `fetch`, not `router.push`.
**Rationale**: the picker lives inside the order `Dialog`. A URL push would re-render the page and drop
the in-progress cart. This is the one place "reuse the existing idiom" must be read narrowly.

### Decision: `customers.write` gates create-inline; empty state is ordered, never simultaneous

**Choice**: the server page passes `canCreateCustomer={can(user, "customers.write")}`. The empty state
renders near matches as primary content and reveals the create action **after** them, only when the grant
is true and only when the near-match set is exhausted or empty.
**Note**: both `tecnico` and `administrador` hold `customers.write` today (`policy.ts:25-26,42-43`), so
this gate denies nobody in production. It is kept for defence in depth and matched to the same check
`handleCreateCliente` already performs.

## Data Flow

    CustomerPicker (Dialog)          GET /api/customers?search=&page=&pageSize=
      typing ──300ms debounce──────→ requireSession → can("customers.read")
                                            │ 403 before any query
                                            ↓
                                     listClientes / countClientes
                                     └─ buildClienteSearchWhere: unaccent(col) ilike unaccent(pat)
                                            │ 0 rows?
                                            ↓ yes
                                     relaxSearchTerm → listClientes (2nd call)
      rows ←────{customers,total,relaxedFrom}─────────┘
      click row → selectedCustomer (survives later searches) → clienteId → POST /api/service-orders

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/app/api/customers/route.ts` | Modify | `handleListClientes` + `GET`, injectable `listClientes`/`countClientes` |
| `src/app/api/customers/route.test.ts` | Modify | GET: authz-before-query, params, near-match flag |
| `src/modules/customers/near-match.ts` | Create | Pure `relaxSearchTerm` |
| `src/modules/customers/near-match.test.ts` | Create | Digits-only, prefix, null-when-too-short |
| `src/modules/service-orders/CustomerPicker.tsx` | Create | Debounced async picker, row, ordered empty state |
| `src/modules/service-orders/CustomerPicker.test.tsx` | Create | jsdom behaviour tests |
| `src/modules/service-orders/ServiceOrderForm.tsx` | Modify | Widen option type; swap `<Select>`; accept `selectedCustomer`, `canCreateCustomer` |
| `src/modules/service-orders/ServiceOrderFormTrigger.tsx` | Modify | Pass the two new props through |
| `src/app/(app)/service-orders/page.tsx` | Modify | Drop the `listClientes` preload; **rewrite** the `PICKER_LIST_LIMIT` comment (line 28-32) to say it now bounds the parts picker only |
| `src/e2e/full-flow.e2e.test.ts` | Modify | The real-SQL search check (below), incl. the unaccented-term case |
| `src/modules/customers/queries.ts` | Modify | `buildClienteSearchWhere` → `unaccent(col) ilike unaccent(pattern)` on name/phone/plate |
| `src/modules/customers/queries.test.ts` | Modify | Compiles the predicate with `PgDialect` and asserts both sides are wrapped |
| `src/shared/db/migrations/0012_enable_unaccent.sql` | Create | `CREATE EXTENSION IF NOT EXISTS unaccent` — generated with `drizzle-kit generate --custom` so the journal entry exists (a hand-written `.sql` never runs) |
| `src/app/(app)/customers/page.tsx` | Unchanged code, changed behaviour | Shares the predicate; its search becomes accent-insensitive too |

`CustomerPicker` is a new file rather than more of `ServiceOrderForm` (already 313 lines) because it is the
only unit under test here and it keeps the picker revert independent of the route revert.

## Interfaces / Contracts

```ts
// GET /api/customers — search: string, page: number = 1, pageSize: number = DEFAULT_PAGE_SIZE (clamped)
type ListClientesResponse = {
  customers: ClienteListItem[];
  total: number;
  /** Present only when `customers` are near matches for a relaxed term. */
  relaxedFrom?: string;
};

// src/modules/customers/near-match.ts
export function relaxSearchTerm(term: string): string | null;
```

## Testing Strategy

Strict TDD. RED order: route unit tests → `relaxSearchTerm` → the e2e SQL check → picker component tests →
implementation.

### Provable with injected seams (`npm test`)

| Layer | What | How |
|---|---|---|
| Route | 403 for a denied user **and** the `listClientes` spy was never called | `x-user-role: "unknown"` — `can()` returns `false` for an unrecognised role (`policy.ts:60-63`) and `parseSessionUser` does not validate it (`session.ts:126-135`), so the deny branch is reachable |
| Route | Throws with no session headers | Same shape as the existing POST test (`route.test.ts:18-24`) |
| Route | Param parsing/clamping; `relaxedFrom` set only on a zero-result primary; second query suppressed when `relaxSearchTerm` returns `null` | Injected `listClientes`/`countClientes` call counters |
| Unit | `relaxSearchTerm`: `####-####` and `+507 ####-####` relax to the same key; short terms return `null` | Pure function |
| Unit | Identifier precedence incl. the phone-null + plate-null customer | Pure function |
| Unit | `buildClienteSearchWhere` wraps **both** the column and the pattern in `unaccent()`, on all three columns, with the pattern still a bound param | `new PgDialect().sqlToQuery(...)` — renders real Postgres SQL + params with no connection |
| Component | One fetch per debounce burst; selection survives a later search that excludes it; near matches render **before** the create action and never beside it; create action absent without `customers.write` | jsdom + mocked `fetch` |

### NOT provable that way — needs a real database

A green suite here proves nothing about the SQL: `buildClienteSearchWhere` is asserted only to be
"defined" (`queries.test.ts:15-17`) and every `listClientes` test injects `queryFn`
(`queries.test.ts:20-29`). Unproven without Postgres:

- that `ilike '%term%'` actually returns the intended rows (mid-string, mixed case, plate, phone);
- that `unaccent(col) ilike unaccent(pattern)` really matches an accented row from an unaccented term —
  the unit test can only prove the SQL *text* wraps both sides; only Postgres proves it *matches*, and
  only after migration `0012` has actually run;
- that `or()` over a **NULL** `phone`/`vehiclePlate` does not silently drop a row (`NULL ILIKE x` is NULL,
  not false) — the plate-less customer must still be findable by name;
- `limit`/`offset` against the real `desc(createdAt)` ordering;
- that the relaxed query really returns a superset of the strict one.

**Named check (required before merge):** a `customer search (E2E)` describe added to
`src/e2e/full-flow.e2e.test.ts`, run with `npm run test:e2e` against a throwaway Postgres, seeding four
`cliente` rows — mixed-case name, null plate, null phone, formatted phone — and calling the real `GET`
handler for each of: partial lowercase name, partial plate, digits-only phone, a term that only the
relaxed pass can match, and **the unaccented form of the accented row** (`"maria gonza"` against
`"María GONZÁLEZ"`). Per `AGENTS.md:178-188`, without this run the change is unverified regardless of
`npm test`.

The unaccented case sits deliberately next to the accented one (`"maría gonzá"`), which passed all along
*by avoiding the failing input*. Both shapes are now locked in, so neither direction of the fold can
regress silently. Its RED was confirmed for real: with `queries.ts` stashed and the rest of the branch in
place, that one case failed (`expected [] to include …`) and the other eleven passed — proving the case
tests the predicate, not the migration.

## Threat Matrix

N/A — every row in `references/threat-matrix.md` covers Git/shell/PR automation
(documentation-like paths, repository selection, commit state, push state, PR commands). This change adds
one authenticated read-only HTTP handler and no shell, subprocess, VCS, or process-integration boundary.
Its real boundary is authorization, covered as a RED test above.

## Migration / Rollout

One migration: `0012_enable_unaccent.sql`, a single `CREATE EXTENSION IF NOT EXISTS unaccent`. No table
change, so the Drizzle snapshot is identical to `0011`'s — the same shape as `0011_fold_category_case.sql`,
and generated the same way (`npx drizzle-kit generate --custom --name enable_unaccent`, which writes the
`.sql`, the snapshot and the journal entry together; a hand-written `.sql` has no journal entry and is
never executed). `unaccent` is a trusted extension on PG 13+, so the `dforce` role creates it without
superuser — verified on PG 17.10, not assumed. `IF NOT EXISTS` makes a re-run a no-op.

Still no new index and no `pg_trgm` — deliberate.

**Known ceiling, now one notch deeper.** `cliente_name_idx` and `cliente_plate_idx` are btree and cannot
serve a leading-wildcard `ilike`, so every search is a sequential scan. Wrapping the column in
`unaccent()` puts an index further out of reach still: `unaccent(text)` is declared **STABLE, not
IMMUTABLE** (it reads a dictionary file, so its result is only guaranteed constant within one statement),
and Postgres refuses to build an index on a non-immutable expression. So `unaccent(name)` cannot be
indexed at all as written.

Correct at 364 rows — a sequential scan over 364 rows is the right answer, and adding an index here would
be optimising a query nobody has measured. But any future `pg_trgm` work must account for this rather than
assume a GIN index drops straight in. Its options, when someone measures a real problem:

- an `IMMUTABLE` wrapper function around `unaccent('unaccent', $1)` (the two-argument form pins the
  dictionary) and a GIN `gin_trgm_ops` index on that expression — the standard workaround, and it makes
  the dictionary part of the index's correctness contract: change it, and the index silently lies;
- or a generated, already-unaccented column indexed normally, trading a schema change and a backfill for
  not having to lie about immutability.

Either is its own change, with a measurement first.

## Review Budget

~300–380 changed lines including tests. Single PR, well inside 800.

## Open Questions

- [ ] `ServiceOrderForm` hides the customer picker in edit mode (`!isEdit`, line 174) and its only caller
      never passes `order` (`service-orders/page.tsx:79-83`), so the "existing order blanks its customer"
      failure is **not reachable today**. The design keeps it correct by construction (prop-seeded
      selection object) rather than adding an unreachable fetch. Confirm the spec scenario is written as a
      component-level guarantee, not as an end-to-end edit flow that nothing renders.
- [ ] Nested `Dialog` (create-customer inside the order dialog) needs a smoke check at apply time; if the
      UI library misbehaves, the fallback is closing the order dialog and navigating to `/customers`.
