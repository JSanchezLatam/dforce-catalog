# Design: Service Order Search, Legible Order Rows, and a Curated Vehicle Catalog

## Technical Approach

Three units, three shapes of work, and only one of them is hard.

1. **WU1 is not an input change, it is a WRITER change.** The console warning
   (`defaultValue` on a URL-driven input) is four lines. The reason WU1 is
   risky is that `CustomerFilters.tsx:45-123` documents two shipped-and-reverted
   attempts at a URL/debounce race whose fix rests on one invariant — *this
   file contains exactly one `router.push`*. A shared search component that
   owned a push would give `/customers` a second writer and re-open the bug on
   its third attempt. So the shared thing is a **hook that owns the single
   push** plus a **dumb controlled input that owns nothing** — D1–D6.
2. **WU2 is new SQL over an existing read model.** `listOrdenesServicio` is a
   bare `db.select().from(ordenServicio)` (`queries.ts:105-119`) with exactly
   one production caller (the list page). Two joins, one `WHERE`, one changed
   `ORDER BY` branch, one narrowed projection — and a set of helpers in
   `customers/` that look reusable and are not (D7). The page-side work is
   mostly the three URL builders that silently drop an unknown parameter (D11).
3. **WU4 is one condition in one pure function** (`reminders/schedule.ts:62-64`),
   and the only real question is which module owns it — D12.

Baseline is `main` @ `a8cd3e0`. Nothing here changes the schema, adds a
migration, adds a route, adds a package or touches `policy.ts` / `ROUTE_GUARDS`.

---

## D1 — The shared thing is a hook that owns the single `router.push`, plus a presentational input that owns nothing

There is no shared filter component today: `InventoryFilters.tsx` is the
original and `CustomerFilters.tsx:26-33` / `ServiceOrderFilters.tsx:17` both say
in prose that they mirror it. Three screens, four text inputs after WU2, and one
screen (`/inventory`) with **two** text inputs on one strip.

| Option | Buys | Costs |
|---|---|---|
| A self-contained `<SearchInput>` that debounces and pushes | one import per call site, nothing to wire | **a second `router.push` on every screen.** `CustomerFilters`'s `commit()` comment (`:94-102`) records that an invariant asserted in prose is not an invariant; this makes two writers the DEFAULT shape. Typing, then touching the status select inside 300ms, is the exact reverted defect |
| A hook only, each screen keeping its own `<Input>` | one writer preserved | the four inputs stay four `<Input>`s, and the spec requirement "no list screen MAY keep an uncontrolled `defaultValue`" is a convention again, enforced by nothing |
| **A hook that owns every push, plus a presentational input with no `defaultValue` prop** | one writer per screen, structurally; an input that **cannot** be uncontrolled because the prop does not exist | two new files instead of one; each call site passes `value` + `onValueChange` |

**Chosen: both, split by who may navigate.**
`src/shared/ui/filters/useUrlFilters.ts` holds the local text state, the
debounce, the re-seed rule, `pushedParamsRef`/`pendingPushes` and **the only
`router.push`**. `src/shared/ui/filters/SearchFilterInput.tsx` is `Label` +
`Input` + `value`/`onValueChange`, no router, no timer, no ref, and **no
`defaultValue` prop to pass**. `src/shared/ui/selection/` is the precedent for a
cross-cutting UI concern living under `shared/ui/` as a hook plus components.

The hook is where the value is; the component exists so the uncontrolled input
cannot come back by hand.

## D2 — Extracted from `CustomerFilters`, not from `InventoryFilters` — and the two other screens inherit a fix, not just a refactor

The proposal calls `InventoryFilters` "the source". That is lineage, not a
quality ranking. Read the two side by side:

- `CustomerFilters.applyFilter` builds from `pushedParamsRef.current ?? window.location.search` (`:126`).
- `InventoryFilters.applyFilter` builds from `searchParams.toString()` (`:39`) — the closure snapshot. That is **reverted attempt #1, still shipping.** Type into `Nombre`, change `Categoría 1` within 300ms, and the debounce fires against a snapshot taken before the category push: the category comes back cleared. `/inventory` has this today.
- `ServiceOrderFilters` has no debounce at all, so it has no race — **until WU2 adds a search box.** Without the hook it would ship the same defect a third time.

**Chosen: the hook is `CustomerFilters`'s machinery, moved.** `/inventory`
gets a latent-bug fix as a side effect (stated in the PR body, not silent), and
`/service-orders` never gets the chance to grow one. Extracting the naive
version instead would mean deliberately shipping the reverted code to two more
screens.

## D3 — Why a controlled input does not re-open the race: the re-seed is gated on the counter that already exists

This is the decision the change lives or dies on, so it is written as
mechanism, not as reassurance.

**What is kept, verbatim**: `pushedParamsRef` (`:73`), `pendingPushes` (`:85`),
`commit()`'s changed-URL guard (`:119`), and `applyFilter` reading
`pushedParamsRef.current ?? window.location.search` (`:126`). All four **move
into the hook unchanged**. Nothing about the race is redesigned, because
nothing about the race changed: the hook is still the only writer, and its ref
is still authoritative the instant it pushes.

**What is added** is one line in the effect that already runs on every
`searchParams` change:

```ts
useEffect(() => {
  const wasOurs = pendingPushes.current > 0;      // read BEFORE the decrement
  if (wasOurs) pendingPushes.current -= 1;
  if (pendingPushes.current === 0) pushedParamsRef.current = null;
  if (!wasOurs) reseedTextFromSearchParams();     // external navigation only
}, [searchParams]);
```

`wasOurs` is not new information — it is the counter's existing meaning, read
one line earlier than the decrement. An external navigation (back button, a
`<Link>` elsewhere) arrives with the counter at **zero**, which is precisely the
case `:80-84` already documents the counter as being for. Our own push landing
arrives with the counter above zero and re-seeds nothing, so local state stays
authoritative while the user types — the spec's *Local State Is Authoritative
While Typing* requirement is that branch.

**What is deleted**: `searchInputRef` (`:92`) and the hand-written
`searchInputRef.current.value = ""` in `clearFilters` (`:141`). Its own comment
names it as a consequence of the input being uncontrolled; `clearAll()` now sets
the state the `value` is bound to. **The ref's disappearance is the proof the
input became controlled** — the spec's *Clearing Filters Updates State, Not a
DOM Node*.

**Seeding**: mount seeds from the caller's `selected.<field>` via a lazy
`useState(() => initial)` — spec-literal, and lazy on purpose so the object
literal the parent rebuilds every render can never re-seed mid-typing. The
*re*-seed at `:reseedTextFromSearchParams` reads `useSearchParams()` instead,
because that is synchronous with the committed URL while the parent's props
arrive with the RSC payload — the same distinction `:57-66` measured.

**Residual, named**: two independent list screens mounted at once would each
hold their own counter. None exists, and none is planned.

## D4 — One debounce timer per key, not one per component

`debounceRef` is a single timer (`:44`). On `/customers` and `/service-orders`
there is one text field, so it cannot matter. On `/inventory` there are two:
typing in `ID` and then in `Nombre` within 300ms clears the first timer, and the
`ID` value is never pushed at all — it is dropped, not merely delayed.

| Option | Buys | Costs |
|---|---|---|
| Keep one timer | zero new code | a cross-field clobber on the one screen that has two fields, moved into shared code where it becomes everyone's |
| **`useRef<Map<string, Timeout>>`, one timer per key** | each field's push survives the other | four lines; `clearAll` iterates the map instead of clearing one handle |

**Chosen: per-key.** Not a WU1 exit criterion and not what the change is for —
recorded because putting the single timer into a shared hook would be a
deliberate choice to keep it.

## D5 — `page` is dropped on every filter change, `pageSize` included

The three screens disagree today. `CustomerFilters.applyFilter` deletes `page`
unless the key is `pageSize` (`:129`); `InventoryFilters.setPageSize` deletes it
always (`:55`). One hook cannot hold both.

**Chosen: always delete `page`.** A `pageSize` change invalidates the page index
arithmetically — page 5 at 10 rows is rows 41-50, and at 100 rows it is 401-500,
which on a 370-row table is an empty screen. `/inventory` is unchanged;
`/customers` and `/service-orders` change, deliberately, with a jsdom assertion
each. Checked against the shipped specs: `table-sorting`'s *Server-Side
Full-Result-Set Sort with Page Reset* pins page-reset for **sorting** only, and
`customer-management` R19 names `pageSize` as a parameter without pinning its
interaction with `page`. Nothing is contradicted.

## D6 — `Limpiar` moves into the hook; the 44×44 floor does not apply to it

`clearAll()` cancels every pending timer (`:139-143`'s reason survives: an
immediate filter must not cancel a debounce, but clearing must), empties the
text state, and pushes the bare pathname through the same `commit`. This deletes
`InventoryFilters`'s `router.push(pathname)` (`:140`) and
`ServiceOrderFilters`'s (`:58`) — the second writers on those two screens.

Both are hand-styled `<button className="px-3 py-1.5 text-sm">` (~30px) and
become the shadcn `Button variant="outline" size="default"` that `/customers`
already uses. **They stay at `h-8`, not `min-h-11`.** AGENTS.md's 44×44 rule
carries a standing exception for "a filter strip whose controls sit against
`h-8` inputs and read as one control", and `CustomerFilters:192-196` is that
exception applied with its measurement. Written here so a reviewer does not
demand 44px and a later agent does not "fix" it upward. **No test in this repo
can measure a rendered height** — this line is the only enforcement.

## D7 — The order search joins `cliente` and `vehiculo` directly. `vehiculoPlateExists` and `buildClienteListWhere` are BOTH wrong here.

Reusing the customers helpers is the obvious move and it is wrong twice over,
in two different files.

**`vehiculoPlateExists` (`customers/vehicles.ts:95-100`) — two independent reasons:**

1. It correlates on `vehiculo.clienteId = cliente.id`. It answers *"does this
   CUSTOMER own a vehicle with this plate"*. An order names **one** vehicle
   (`orden_servicio.vehiculoId`, `schema.ts:422`). Reused, searching a plate
   would return that customer's orders for their **other** cars.
2. It applies `activeVehiculoFilter()` — active vehicles only. An order can
   reference a vehicle deactivated afterwards, and that is a supported state the
   repo already pins:
   `service-orders/[id]/print/page.test.tsx:199-209` asserts a deactivated
   vehicle still renders its identity. Reused, those orders would vanish from
   search with no error anywhere.

**`buildClienteListWhere` (`customers/queries.ts:84-91`) — the same trap, second
table.** It applies `isNull(cliente.deactivatedAt)` by default. An order for a
customer deactivated afterwards is still a real order; that filter would hide it.

| Option | Buys | Costs |
|---|---|---|
| Reuse `buildClienteSearchWhere` (which ORs name, phone and `vehiculoPlateExists`) | one call, two-thirds correct | both defects above, and both are invisible on today's 2-row table |
| Correlated subselects owned by `vehicles.ts`, mirroring `platesSubquery()` | keeps `vehiculo`'s sole-owner rule literal | three subselects for `plate`/`make`/`model` in the projection where one join clause reads plainly; and the ownership rule's real purpose ("pages and the API never see a raw query builder") is not what a read-model join threatens |
| **Two INNER joins in `service-orders/queries.ts`, plate matched as a plain column comparison** | the simplest SQL anyone can read; the vehicle is already 1:1 on this table | `vehiculo` gains a second value-import, amending `vehicles-one-to-many` D3's "imported here and nowhere else" |

**Chosen: the joins.** On the orders list the vehicle is joined one-to-one, so
the plate is `unaccentIlike(vehiculo.plate, pattern)` — a column comparison, not
an existence check. The ownership amendment is recorded in `vehicles.ts`'s
header, and a comment goes **on `vehiculoPlateExists` itself** naming the two
reasons the orders path does not call it — the archived
`service-order-intake-and-print` D2 puts the warning where the wrong move gets
made, not where the right one lives.

**Why INNER is safe and no row is silently dropped:** `orden_servicio.clienteId`
and `.vehiculoId` are both `.notNull()` with `onDelete: "restrict"`
(`schema.ts:416-424`). No order can exist without a live `cliente` and
`vehiculo` row, and neither parent can be deleted while an order references it.
A `LEFT JOIN` would only add a `null` branch for a state the database forbids.
The e2e asserts the unfiltered row count is unchanged anyway, because that is
the claim a green unit suite cannot make.

## D8 — `unaccentIlike` moves to `src/shared/db/text-search.ts`

It is private at `customers/queries.ts:46`. WU2 needs the identical fold.

| Option | Buys | Costs |
|---|---|---|
| Duplicate it in `service-orders/queries.ts` | zero cross-module edges | two copies of one accent-folding rule; the repo has already been bitten by `ROLE_LABELS` drifting. The failure mode here is silent and screen-specific: "perez" matches on `/customers` and not on `/service-orders` |
| `export` it from `customers/queries.ts` | one word of diff | every future caller imports a file whose own docstring says "DB read model for `cliente`" to compare two strings |
| **Move to `src/shared/db/text-search.ts`** | a neutral home, one import each, no cycle | WU2 touches a `customers/` file (a one-line import swap) |

**Chosen: the move.** `src/shared/datetime.ts` is the precedent for a
cross-cutting pure helper of exactly this size. The docstring travels with the
function, including the caveat that **`unaccent()` is STABLE, not IMMUTABLE, so
it can never back an expression index** — that constraint now applies to
`vehiculo.plate` and `cliente.name` on the orders path too. Irrelevant at
370 customers and 2 orders; recorded so the next reader does not rediscover it
by writing a migration that fails.

**Not shared: the `or(...)` itself.** `buildClienteSearchWhere` and the orders
predicate agree on two of three terms and must differ on the third (D7).
Extracting the agreement would produce a helper that is two-thirds of each. The
accepted divergence, stated: if `/customers` later searches `email`,
`/service-orders` will not follow automatically.

## D9 — A narrowed `OrdenServicioListItem`, and one `WHERE` builder shared by list and count

`listOrdenesServicio` returns `OrdenServicio[]` and has exactly one production
caller (`service-orders/page.tsx:79`) plus its tests, so the return type is
free to narrow. Mirror `ClienteListItem` (`customers/queries.ts:29`): a `Pick`
plus the joined fields.

The trap worth naming: **`countOrdenesServicio` must build from the same
`WHERE`**. Its `queryFn` (`queries.ts:124-127`) has no join today; a search
predicate over `cliente.name` cannot be evaluated without one. Extend
`buildOrdenServicioWhere(filters)` (already shared by both) and add the same two
joins to both `queryFn`s. Missed on the count, the list filters and the pager
does not: page 2 of a search that has 4 rows.

## D10 — The unsorted default gains one expression, and its RED test already exists

`buildOrdenServicioOrderBy`'s no-sort branch returns `[desc(createdAt)]`
(`queries.ts:96-102`). It becomes
`[sql`${ordenServicio.appointmentAt} desc nulls last`, desc(createdAt)]` — the
`nulls last` construction the same function already uses for every explicit
sort, for the reason its comment gives (Drizzle's `asc()`/`desc()` append the
direction after the expression, so `nulls last` cannot live inside `ORDEN_SORT`).

`queries.test.ts:118` asserts `buildOrdenServicioOrderBy(undefined)` has
**length 1**. That is a real RED already in the tree: it must go red on the
change and be updated to 2, with the rendered primary asserted to contain
`desc nulls last` via the `PgDialect().sqlToQuery()` idiom the file already uses
(`:112`). `ORDEN_SORT` is untouched — no new sortable column, no joined
`ORDER BY`.

## D11 — The page's three URL builders and its filter key must all learn `search`

`/service-orders`'s helpers carry `status` and `pageSize` and nothing else:
`buildSortHref` (`page.tsx:320`), `buildPageHrefPattern` (`:337`),
`buildFilterKey` (`:270`), plus `normalizeOrdenFilters` (`:50`). A new URL
parameter that they do not know about is **dropped silently** — click a column
header or page 2 and the search term is gone, with no error.

`customers/page.tsx` is the worked template and its comments record both bugs
this class already caused there (`:485-489` a `search` array shape dropped; a
`pageSize` dropped from a hand-built link). Mirror it exactly, including
`firstValue` for every key.

`buildFilterKey` gains `search` for the same reason
`customers/page.tsx:392-397` has it: it is what clears an operator's bulk
selection when the visible set changes, and `search` changing the visible set is
the whole feature. Consequence, accepted: each debounced keystroke clears the
selection, exactly as on `/customers`.

## D12 — The `service_due` category condition belongs in `planReminders`, not at the `transitionOrder` call site

`transitionOrder` calls `planAndScheduleReminders(..., "service_due", ...)` on
every `→ done` transition with no category check (`service.ts:303-308`).
`planReminders` already schedules at `completedAt + SERVICE_DUE_AFTER_DAYS`
(`schedule.ts:62-64`).

| Option | Buys | Costs |
|---|---|---|
| Guard at the `transitionOrder` call site | matches `schedule.ts:40-43`'s docstring, which says callers "decide WHICH of the returned types to actually persist"; no new import direction | the rule lives at one call site, and a second caller asking for `service_due` inherits none of it. `planReminders` keeps claiming a `revisado` order's reminder is due |
| **Inside `planReminders`** | one truth: "what reminders are due, given this snapshot" — the docstring's own words, and `order.categoria` **is** part of the snapshot it already receives | a category set now lives in `reminders/` |

**Chosen: `planReminders`.** The docstring's division of labour is caller-picks-a
-TYPE / function-decides-DUENESS, and "a `revisado` order has no 90-day service
interval" is a dueness fact, not a type selection. The module already owns the
sibling policy: `SERVICE_DUE_AFTER_DAYS = 90` is itself a maintenance-interval
rule living in `schedule.ts`. *Which* services have an interval is the same
question as *how long* it is.

**Where the category set lives, and why not `categories.ts`.**
`service-orders/service.ts:16-18` states the dependency direction explicitly:
service-orders depends on `reminders/*`, "never the other way around, so there's
no import cycle". Importing `service-orders/categories.ts` into `schedule.ts`
would reverse it. `schedule.ts:7` **already imports `type { OrdenServicio }`**
from the schema, so the set types itself off the enum with no new module edge:

```ts
const SERVICE_DUE_CATEGORIES: readonly OrdenServicio["categoria"][] = ["mant_preventivo", "mant_correctivo"];
```

That is type-checked against the Postgres enum — a typo will not compile. The
drift it *cannot* catch is a **sixth** category being added and nobody deciding
whether it schedules. The guard for that is the test, not the type: the unit
test iterates `CATEGORIA_LABEL`'s own keys (a test-only import across modules,
no production edge) and requires an explicit expected outcome for each, so a new
enum value fails by name until someone lists it.

## WU3 — Vehicle catalog: not designed here

**Blocked on the owner supplying the make/model list.** The proposal's Open
Question names it and scopes it to WU3 alone. No decision above depends on it,
and no file WU3 touches (`customers/vehicle-catalog.ts`, `VehicleQuickForm.tsx`,
`CustomerForm.tsx`) is touched by WU1, WU2 or WU4. When the list lands, WU3 gets
its own decisions appended to this document — including the latent
`validation.ts:126` trap the archived design already recorded (`year` is kept
only when it is *already* a number).

## Data Flow

```
WU1 — one writer per screen, still
  CustomerFilters / InventoryFilters / ServiceOrderFilters  ("use client")
        │
        ├─ SearchFilterInput  value / onValueChange   ← no router, no timer, no defaultValue
        │        │
        └────────┴─▶ useUrlFilters()
                        text{}  setText(k,v) ─debounce(k)─┐
                        applyFilter(k,v) ─────────────────┤   (selects, immediate)
                        clearAll() ───cancel all timers───┤
                                                          ▼
                                   commit(params)  ── THE only router.push
                                      pushedParamsRef = params ; pendingPushes++
                                                          │
                     useEffect([searchParams]) ◀──────────┘ (or an EXTERNAL nav)
                        wasOurs = pendingPushes > 0
                          true  → decrement, release ref, DO NOT re-seed   (D3)
                          false → re-seed text from searchParams           (D3)

WU2 — /service-orders?search=…
  page.tsx  normalizeOrdenFilters → {status?, search?}
        │   buildSortHref / buildPageHrefPattern / buildFilterKey  ← all carry `search`  (D11)
        ▼
  listOrdenesServicio            countOrdenesServicio      ← same WHERE, same joins  (D9)
        │                              │
        └── from(ordenServicio) ───────┘
              innerJoin(cliente,  ordenServicio.clienteId  = cliente.id)     NOT NULL + RESTRICT
              innerJoin(vehiculo, ordenServicio.vehiculoId = vehiculo.id)    NOT NULL + RESTRICT
              where or( unaccentIlike(cliente.name)                          (D7)
                        unaccentIlike(cliente.phone)
                        unaccentIlike(vehiculo.plate) )   ← plain column, NOT vehiculoPlateExists
                                                          ← no activeVehiculoFilter, no deactivatedAt filter
              orderBy appointment_at desc nulls last, created_at desc        (D10)
        ▼
  ID(8 chars, mono) · Cliente · Vehículo(placa) · Estado · Cita · Acciones

WU4 — transitionOrder(id, "done")
        └─▶ planAndScheduleReminders(updated, cliente, "service_due")
                └─▶ planReminders(order, cliente, now)
                        completedAt && SERVICE_DUE_CATEGORIES.includes(order.categoria)   (D12)
                          ├─ mant_preventivo | mant_correctivo → plan at +90d
                          └─ instalacion | reparacion | revisado → nothing
```

## File Changes

| File | Action | Description | WU |
|---|---|---|---|
| `src/shared/ui/filters/useUrlFilters.ts` | Create | the single writer: text state, per-key debounce, `pushedParamsRef`/`pendingPushes`, external-nav re-seed, `clearAll` (D1/D3/D4/D5) | 1 |
| `src/shared/ui/filters/SearchFilterInput.tsx` | Create | `Label` + controlled `Input`; no router, no timer, **no `defaultValue` prop** (D1) | 1 |
| `src/shared/ui/filters/useUrlFilters.test.tsx` | Create | the race suite, moved from `CustomerFilters.test.tsx` with its `next/navigation` mock (D3) | 1 |
| `src/modules/customers/CustomerFilters.tsx` | Modify | uses the hook; `searchInputRef` and the DOM write at `:141` **deleted** (D3) | 1 |
| `src/modules/inventory-view/InventoryFilters.tsx` | Modify | both inputs controlled; `applyFilter`'s stale-closure read and the second `router.push` at `:140` deleted (D2/D6) | 1 |
| `src/modules/service-orders/ServiceOrderFilters.tsx` | Modify | uses the hook; second `router.push` at `:58` deleted (D6) | 1 |
| `src/modules/customers/CustomerFilters.test.tsx` | Modify | keeps status/compose coverage; race suite moves out (D3) | 1 |
| `src/modules/inventory-view/InventoryFilters.test.tsx`, `src/modules/service-orders/ServiceOrderFilters.test.tsx` | Create/Modify | controlled-value + `Limpiar` coverage per screen | 1 |
| `src/shared/db/text-search.ts` | Create | `unaccentIlike`, moved with its STABLE-not-IMMUTABLE docstring (D8) | 2 |
| `src/modules/customers/queries.ts` | Modify | import `unaccentIlike` instead of declaring it (D8) | 2 |
| `src/modules/customers/vehicles.ts` | Modify | comment on `vehiculoPlateExists` naming the two reasons the orders path does not call it; header records the second reader of `vehiculo` (D7) | 2 |
| `src/modules/service-orders/queries.ts` | Modify | joins, `search` in `OrdenServicioFilters` + `buildOrdenServicioWhere`, `OrdenServicioListItem`, count parity, no-sort ORDER BY (D7/D9/D10) | 2 |
| `src/modules/service-orders/queries.test.ts` | Modify | `toHaveLength(1)` → 2 + rendered `desc nulls last`; rendered `WHERE` for the search predicate (D10) | 2 |
| `src/app/(app)/service-orders/page.tsx` | Modify | `search` in `normalizeOrdenFilters`, `buildSortHref`, `buildPageHrefPattern`, `buildFilterKey`; new `COLUMNS`; truncated mono ID; `Descripción` removed (D11) | 2 |
| `src/app/(app)/service-orders/page.test.tsx` | Modify | column set, truncation, `search` survives sort/paging | 2 |
| `src/e2e/full-flow.e2e.test.ts` | Modify | new `service-order search (E2E)` describe — **WU2 exit criterion** | 2 |
| `src/modules/reminders/schedule.ts` | Modify | `SERVICE_DUE_CATEGORIES` gate on the `completedAt` branch (D12) | 4 |
| `src/modules/reminders/schedule.test.ts` | Modify | all five categories, driven off `CATEGORIA_LABEL`'s keys (D12) | 4 |
| `src/modules/service-orders/service.ts` | **Unchanged** | `transitionOrder` keeps calling for `"service_due"`; the gate is downstream (D12) | — |
| `src/modules/service-orders/ORDEN_SORT`, `parseOrdenSort` | **Unchanged** | no sort by customer or plate; no joined `ORDER BY` (D10) | — |
| `src/shared/db/schema.ts`, migrations, `policy.ts`, `ROUTE_GUARDS` | **Unchanged** | no schema change, no new route, no new `Action` anywhere in this change | — |

## Interfaces

```ts
// src/shared/ui/filters/useUrlFilters.ts — "use client". The ONE router.push per screen (D1).
// `initialText` is read ONCE, lazily, at mount — the caller rebuilds the literal every render
// and it must never re-seed mid-typing (D3). Re-seeding reads useSearchParams(), not props.
export type UrlFilters = {
  /** Local text state, authoritative while typing. */
  text: Record<string, string>;
  /** Keystroke: updates `text` immediately, pushes after `debounceMs`. */
  setText: (key: string, value: string) => void;
  /** Selects and anything else with no keystrokes to wait out — pushes immediately. */
  applyFilter: (key: string, value: string) => void;
  /** Cancels every pending timer, empties `text`, pushes the bare pathname. Never touches the DOM. */
  clearAll: () => void;
};
export function useUrlFilters(initialText: Record<string, string>, debounceMs?: number): UrlFilters;

// src/shared/ui/filters/SearchFilterInput.tsx — "use client". Owns nothing.
// There is deliberately no `defaultValue` prop: an uncontrolled URL-driven input
// cannot be written at a call site (list-search-filters, "Applies Uniformly").
export function SearchFilterInput(props: {
  id: string;
  label: string;            // Spanish, e.g. "Filtro"
  placeholder: string;      // Spanish
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}): React.JSX.Element;

// src/shared/db/text-search.ts — moved from customers/queries.ts:46 (D8).
// unaccent() is STABLE, not IMMUTABLE: it can never back an expression index,
// on `cliente.name`, `cliente.phone` or `vehiculo.plate`.
export function unaccentIlike(column: PgColumn, pattern: string): SQL;

// src/modules/service-orders/queries.ts — D7/D9
export type OrdenServicioFilters = { status?: OrderStatus; search?: string };

/** Mirrors ClienteListItem: a Pick plus the joined fields, nothing wider. */
export type OrdenServicioListItem = Pick<OrdenServicio, "id" | "status" | "appointmentAt"> & {
  clienteName: string;
  vehiculoPlate: string;
  vehiculoMake: string | null;
  vehiculoModel: string | null;
};

/**
 * Status + search. The plate term is a PLAIN comparison against the joined
 * `vehiculo.plate` — NOT `vehiculoPlateExists`, which correlates on the CUSTOMER
 * and filters to active vehicles (D7). Shared by list and count, or the pager lies (D9).
 */
export function buildOrdenServicioWhere(filters: OrdenServicioFilters): SQL | undefined;

export function listOrdenesServicio(
  filters: OrdenServicioFilters,
  window: { offset: number; limit: number },
  sort?: OrdenSort,
  queryFn?: () => Promise<OrdenServicioListItem[]>,
): Promise<OrdenServicioListItem[]>;

// src/modules/reminders/schedule.ts — D12. Typed off the schema enum, so a typo
// does not compile; `service-orders/categories.ts` is NOT imported (direction rule).
// A SIXTH category is caught by the test, not by the type.
const SERVICE_DUE_CATEGORIES: readonly OrdenServicio["categoria"][] = ["mant_preventivo", "mant_correctivo"];
```

## Testing Strategy

| Layer | What | How | WU |
|---|---|---|---|
| Component (jsdom) | Input shows `?search=` on mount; shows each keystroke before the debounce; back button re-seeds to empty; two pushes outstanding keep every filter; `Limpiar` empties the box with **no DOM write** | `useUrlFilters.test.tsx`, carrying `CustomerFilters.test.tsx:10-97`'s late-landing `next/navigation` mock verbatim — a synchronous mock manufactures the property under test and its own comment says so. **Mutation-verify** by reverting the `wasOurs` guard: the re-seed test must go red **by name** | 1 |
| Component (jsdom) | Per screen: the search box is wired to the right URL key; a debounced search does not clobber a select touched inside 300ms; `Limpiar` clears both | one test per filter file — the shared race suite is not repeated three times | 1 |
| Component (jsdom) | `/inventory`: typing in `ID` then `Nombre` inside 300ms pushes **both** | `InventoryFilters.test.tsx` (D4) | 1 |
| **Browser, console open — the only evidence that exists** | Zero console warnings while typing on all three screens; back/forward re-seeds; `Limpiar` empties the field | jsdom does not run Base UI's dev-mode warning path (the spec's own Verification Notes). Recorded in the PR body | 1 |
| Unit (node) | `buildOrdenServicioWhere` renders name/phone/plate ORed with `unaccent(...) ilike unaccent(...)`, and **no** `deactivated_at is null` in either table | `queries.test.ts` via `PgDialect().sqlToQuery()`, the idiom already at `:112`. Proves the SQL TEXT, never that Postgres accepts it | 2 |
| Unit (node) | No-sort ORDER BY is two expressions, primary `appointment_at desc nulls last` | same file — `:118`'s `toHaveLength(1)` is a **standing RED** that must fail on this change | 2 |
| Component (jsdom) | Header row has no `Descripción`; `ID` cell reads exactly the first 8 chars in mono; `Cliente` and `Vehículo` render; `search` survives a column-header click and a page link | `page.test.tsx`; assert the Spanish headers, never loosened | 2 |
| **e2e (real Postgres, NOT in `npm test`)** | Finds an order by customer name (accent-folded), by phone, by plate; **an order whose vehicle was deactivated afterwards is still found by that plate**; searching a plate of the customer's OTHER vehicle returns **zero** orders; `description` matches nothing; unfiltered row count unchanged; default order is A(appt +7d) → B(appt −1d) → C(appt NULL) where A was created LAST | new describe in `full-flow.e2e.test.ts`, beside `vehicle search (E2E)`. **WU2 exit criterion.** The fixture MUST seed `appointmentAt` and `createdAt` disagreeing and one customer with two vehicles — with today's 2 near-identical rows every claim above is unfalsifiable | 2 |
| Unit (node) | All five categories: two schedule `service_due`, three schedule none; the `appointment` path is untouched for all five | `schedule.test.ts`, driven off `CATEGORIA_LABEL`'s keys so a sixth category fails by name. **Mutation-verify** by adding `revisado` to the set — the test must go red by name | 4 |

**What only a browser can settle** (AGENTS.md's second known limit, restated
because two production defects shipped under a green suite): Base UI's dev-mode
warning path; a hydration mismatch; an RSC serialization refusal. WU1 changes
what crosses into three `"use client"` components and WU2 changes what
`page.tsx` hands them — a green `npm test` is not evidence for either. **What
only real Postgres can settle**: every row of WU2's join and `WHERE`.
`vitest.config.ts` points `DATABASE_URL` at a nonexistent database, so a fully
green suite *proves* the real branch never ran.

## Threat Matrix

N/A — no shell command, subprocess, VCS/PR automation, executable-file
classification, routing change or process-integration boundary. No new route, no
new `Action`, no `ROUTE_GUARDS` entry, no new package, no new job.

Two untrusted-input surfaces, closed in the design rather than left implicit:

- **`?search=`** reaches Postgres only as a Drizzle bound parameter through the
  `sql` template (`unaccent(${column}) ilike unaccent(${pattern})`), never
  concatenated. `%` and `_` in a term are treated as ILIKE wildcards — the
  existing, shipped behaviour on `/customers`, unchanged and not widened here.
- **`?search=a&search=b`** is read through `firstValue`, matching
  `normalizeClienteFilters`. The comment at `customers/page.tsx:485-489` records
  the bug the missing normalization already caused once: the page filtered by
  "a" while page 2's link carried no search at all.

## Migration / Rollout

No migration, no schema change, no data backfill. Three units on the repo's
feature-branch chain, tracker draft until every child lands.

| WU | Authored lines (est.) | 800-line budget risk | Base | Independently revertible |
|---|---|---|---|---|
| 1 — shared hook + input, three screens rewired | ~280 | Low | tracker | Yes |
| 2 — join, search, columns, default order, e2e | ~350 | Low | WU1 | Yes |
| 4 — `service_due` category condition | ~80 | Low | tracker | Yes |

WU1 → WU2 is the only dependency (WU2 adds the fourth call site of WU1's
component). WU4 shares no file with either and can land first.

Reverting WU1 restores three uncontrolled inputs and the console warning, and
re-introduces `/inventory`'s stale-closure race — nothing persisted changes.
Reverting WU2 restores `db.select().from(ordenServicio)` and `desc(createdAt)`;
it adds no write path and no migration, so no row is affected. Reverting WU4
restores the reminder for all five categories; `reminder` rows already written
are untouched and still fire.

## Open Questions

- [ ] **WU3's make/model list.** Blocks WU3's spec and design only; nothing
      above depends on it.
- [ ] **Whether `Vehículo` renders make/model beside the plate or the plate
      alone.** The delta only requires the plate to appear. The projection
      carries `make`/`model` (both nullable) so the page can render a muted
      second line; `sdd-tasks` may drop them if the column reads better bare.
- [ ] **`/inventory`'s search does not accent-fold at all** — `inventory-view/queries.ts`
      uses bare `ilike`. Now that `unaccentIlike` has a neutral home (D8) this is
      a two-line change, and it is deliberately **not** in this one. Follow-up.
