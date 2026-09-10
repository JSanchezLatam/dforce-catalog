# Proposal: Service Order Search, Legible Order Rows, and a Curated Vehicle Catalog

## Intent

Three unrelated symptoms share one cause: `/service-orders` was built as a
standalone table over `orden_servicio` and never reached the rows a workshop
actually identifies an order by — the customer and the plate.

- **The list is unusable at volume.** Status is the only filter, and a full
  UUID eats the first column's width. A service advisor holding a plate has no
  way to find that order except paging. `/customers` solved this already (R19:
  one combined search box); `/service-orders` never got it.
- **`listOrdenesServicio` cannot answer the question.** It is a bare
  `db.select().from(ordenServicio)` with no join (`service-orders/queries.ts:105`),
  so customer name and plate are simply not in the projection. Search and
  columns are therefore **one piece of work**, not two.
- **The list sorts by a date it does not show.** The table renders `Cita`
  (`appointmentAt`) while the unsorted default is `desc(createdAt)`
  (`queries.ts:97`, under a comment claiming "newest first by default"). Two
  different dates — one read, one sorting. With today's 2 rows they agree; the
  first order created today for next week makes them diverge, and the list then
  reads as unsorted while being perfectly sorted by something invisible.
- **The search box on `/customers` throws a dev-overlay warning on every
  keystroke.** The search works; what the owner sees is Base UI's
  *"A component is changing the default value state of an uncontrolled
  FieldControl after being initialized"* — `CustomerFilters.tsx:158` renders
  `defaultValue={selected.search ?? ""}` on an input whose URL-driven value
  changes after mount. The tell was already in the file: `clearFilters` writes
  `searchInputRef.current.value = ""` by hand (`:141`) because clearing the URL
  cannot clear an uncontrolled box. **The same defect exists twice in
  `InventoryFilters.tsx` (`:70`, `:80`)** — three inputs, two screens, and a
  new order-search box would be the fourth.
- **Free-text make/model is about to become a data-quality problem.** The dev
  database holds 370 customers and **3 vehicles**. The fleet gets typed in by
  hand from here, through the inline vehicle form that just shipped, so the
  constraint is worth adding now and worthless later.
- **The 90-day reminder fires for the wrong services.**
  `SERVICE_DUE_AFTER_DAYS = 90` and `planReminders` scheduling `service_due` at
  `completedAt + 90 days` already exist (`reminders/schedule.ts:11,63`). What is
  missing is the category condition: it fires for **all five** categories
  (`service-orders/categories.ts:16`).

## Scope

### In Scope

| # | Deliverable |
|---|---|
| 1 | One shared **controlled** URL-driven search input, replacing the three uncontrolled copies (`CustomerFilters`, `InventoryFilters` ×2) |
| 2 | `listOrdenesServicio` joins `cliente` and `vehiculo`, in **both** projection and `WHERE` |
| 3 | `/service-orders` search box over customer name, phone and plate — the same three columns `buildClienteSearchWhere` ORs |
| 4 | Columns become `ID · Cliente · Vehículo (placa) · Estado · Cita · Acciones`; `Descripción` is removed and `ID` is truncated to its first 8 characters in monospace (`87cceecc`) |
| 5 | The unsorted default becomes `appointmentAt` DESC nulls last, with `desc(createdAt)` kept as the tiebreak |
| 6 | A curated in-repo vehicle catalog; `marca`/`modelo` become selects with an **"Otro"** free-text escape, on both write paths |
| 7 | `service_due` restricted to `mant_preventivo` and `mant_correctivo` |

### Out of Scope — named, not forgotten

- **`revisado` reminders.** Restricting item 7 is a **behaviour REMOVAL** for
  `instalacion`, `reparacion` and `revisado`. `revisado` is Panama's mandatory
  **annual** ATTT inspection: a 90-day reminder was always wrong for it, and a
  365-day one is what it actually wants. **Its own change** — this one only
  stops the wrong reminder.
- **Sorting `/service-orders` by customer or plate.** A joined `ORDER BY` needs
  `lower(unaccent(...))` wrapping like `CLIENTE_SORT`, i.e. a second body of new
  SQL on top of the join. `ORDEN_SORT` is untouched by this change.
- **Shortening the stored `id`.** Truncation is display-only; the detail page
  still shows the full UUID, and no URL, route or query changes.
- **Unbounded `text` on `plate`/`make`/`model`** (already-recorded follow-up).
  This change does **not** absorb it: `plate` stays free text on both paths, and
  "Otro" reopens make/model. It makes the follow-up smaller, not unnecessary.
- **Backfilling the 3 existing vehicles** to catalog values.
- **A `reminders` capability spec.** Reminder scheduling is entirely unspecced
  today; this change specs only the category condition.
- **Searching order `description`.** Excluded for the same reason it is excluded
  from `ORDEN_SORT`: unindexed free text.
- **Any network vehicle source, cache table or sync job** — see Approach.

## Capabilities

### New Capabilities
- `list-search-filters`: the shared, controlled, URL-driven search input
  contract across list screens. Cross-cutting by precedent — `table-sorting`
  and `table-bulk-actions` are already shaped this way.
- `vehicle-catalog`: the curated dataset, its correctability, and the mandatory
  free-text escape.

### Modified Capabilities
- `service-orders`: list search, column set, and `service_due` category
  condition.
- `customer-management`: `marca`/`modelo` inputs on both vehicle write paths.
- `table-sorting`: **not the whitelist** — *Unsorted Default Is Byte-Identical
  to Pre-Change Behavior* names `desc(createdAt)` for service orders in its own
  text (spec.md:105-110), so the new default needs an explicit carve-out there;
  and *NULL Ordering for Nullable Sort Columns* is written for "the active sort
  column", which the new default is not.

## Approach

**One shared search input, not three patches.** Local state stays authoritative
while the user types; props re-seed it only on an **external** navigation (back
button, `<Link>`). `CustomerFilters.tsx:45-89` documents two shipped-and-reverted
attempts at this component's URL/state race (`pushedParamsRef`, `pendingPushes`)
— the spec must state explicitly how the controlled input avoids re-opening it,
and the ref hack at `:141` must disappear as proof it did.

**The join is new SQL.** AGENTS.md's injected-seam limit means a green
`npm test` proves *zero* coverage of it. **An e2e row against real Postgres is
an exit criterion, not a nice-to-have.**

**Sort by the date the table shows.** `buildOrdenServicioOrderBy` already emits
`nulls last` for every explicit sort and already keeps `desc(createdAt)` as an
unconditional tiebreak for stable paging (`queries.ts:96-102`). The change is
its no-sort branch, which today returns the tiebreak alone: it becomes
`appointmentAt` DESC nulls last **plus** that same tiebreak. Orders with no
appointment fall to the bottom through the mechanism that is already there — no
new ordering machinery. This deliberately breaks *Unsorted Default Is
Byte-Identical to Pre-Change Behavior* for this one table, which is why the
delta amends that requirement in the open rather than quietly diverging from it.

**The ID column stays, truncated.** First 8 characters, monospace, full UUID
still on the detail page. Display-only: no route, URL, query or whitelist
changes, so the invariant that `ORDEN_SORT` is imported by both the query and
the page (`queries.ts:28-30`) is never put under strain.

**A curated local list, and why the obvious sources were rejected.** vPIC
(`vpic.nhtsa.dot.gov`, verified live) returns 58 Toyota models containing
**none** of Hilux, Fortuner, Prado or Rush; it carries "Land Cruiser" but not
"Land Cruiser Prado", a distinct non-US model. vPIC and `us-car-models-data` are
both built on US registrations. This is a Panama workshop whose fleet is largely
Japanese, Korean and Chinese imports that never reached the US — either source
pushes staff back to free text for exactly the vehicles they see most.
"Suggest from what's in the database" was rejected too: it starts empty (3 rows).
A curated file needs no network, no cache table and no sync job, and is
correctable in place. **"Otro" is mandatory** — a dropdown that cannot express a
real vehicle is worse than a text box.

Both write paths must agree: `VehicleQuickForm.tsx` and `CustomerForm.tsx`'s
vehicle collection. Note the latent trap at `validation.ts:126` — `year` is kept
only when it is *already* a number.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~1,180 (WU1 ~250, WU2 ~350, WU3 ~500, WU4 ~80) |
| Review budget | 800 lines per PR |
| 800-line budget risk | **Low** per unit, **Medium** total |
| Chained PRs recommended | Yes — for WU1 → WU2 only |
| Chain strategy | feature-branch-chain (repo convention) |

### Suggested Work Units

| Unit | Goal | Lines | Base | Verification |
|---|---|---|---|---|
| 1 | Shared controlled search input; rewire `CustomerFilters` + `InventoryFilters` ×2; delete the `searchInputRef` hack | ~250 | tracker | jsdom tests + **browser, console open** — the warning must be gone, and back-button re-seeding must work |
| 2 | SO-1 + SO-2: join, search `WHERE`, columns, ID truncation, default order | ~350 | PR 1 | **e2e against real Postgres, required** — the join is unproven by any green suite |
| 3 | Vehicle catalog + `marca`/`modelo` selects on both write paths | ~500 | tracker | jsdom on both forms + browser check; **~300 of these lines are data rows** — review the shape and the escape, not each row |
| 4 | `service_due` restricted to two categories | ~80 | tracker | node tests, all five categories asserted |

WU1 → WU2 is the only real dependency. WU3 and WU4 touch disjoint files and can
land in any order.

WU2's ~350 is mostly the join and the search `WHERE`. The default-order change
is three lines of query code but ~50 with its tests, because the guarantee that
the unsorted default is stable has to be re-asserted against the new expected
order, on seeded data where the two dates disagree. Truncation is a handful of
lines and one assertion.

```
tracker (draft, no-merge)
  ├── 1 shared search input ── 2 order list join + search + columns
  ├── 3 vehicle catalog
  └── 4 reminder category condition
```

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/shared/ui/` | New | Shared controlled search input |
| `src/modules/customers/CustomerFilters.tsx` | Modified | Controlled; ref hack removed |
| `src/modules/inventory-view/InventoryFilters.tsx` | Modified | Both inputs controlled |
| `src/modules/service-orders/queries.ts` | Modified | Join, search `WHERE`, no-sort branch of `buildOrdenServicioOrderBy` |
| `src/modules/service-orders/ServiceOrderFilters.tsx` | Modified | Gains the search box |
| `src/app/(app)/service-orders/page.tsx` | Modified | Column set, ID truncation |
| `src/modules/customers/vehicle-catalog.ts` | New | Curated dataset |
| `src/modules/customers/VehicleQuickForm.tsx`, `CustomerForm.tsx` | Modified | Selects + "Otro" |
| `src/modules/reminders/schedule.ts` | Modified | Category condition |
| `src/e2e/full-flow.e2e.test.ts` | Modified | Join coverage |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Controlled input re-opens the URL/state race reverted twice before | Med | Spec states the re-seed rule; the removed ref hack is the proof |
| The join silently drops orders (inner vs left join) | Med | `orden_servicio.vehiculoId` is `NOT NULL`; e2e asserts the row count is unchanged |
| The new default order contradicts a shipped requirement | **Certain** | Amend *Unsorted Default Is Byte-Identical* explicitly in the delta; a silent divergence is the failure mode, not the change itself |
| Curated list omits a vehicle staff actually see | High | "Otro" is mandatory, and the file is correctable in a one-line PR |
| Removing three reminder categories surprises the owner | Med | Stated here as a removal; `revisado`'s 365-day replacement is a named follow-up |

## Rollback Plan

Per unit, and each is a clean revert. WU2 is the only one with new SQL: it adds
no migration and no write path, so reverting the join and the no-sort branch
restores the previous `db.select()` and `desc(createdAt)` default, and existing
rows are untouched. WU3's dataset is a new file — a
revert returns `marca`/`modelo` to free text and any value already stored
(catalog or "Otro") remains valid, because both are plain `text`. WU4's revert
restores the reminder for all five categories.

## Dependencies

- WU3 needs the owner's corrections to the drafted make/model list (see below).
- WU2 needs seeded orders with customers and vehicles, **including orders whose
  `appointmentAt` and `createdAt` disagree** — `/service-orders` and the vehicle
  table are near-empty today, and with 2 rows the two dates agree, which is
  exactly the condition under which the defect is invisible.

## Success Criteria

- [ ] Typing in the `/customers`, `/inventory` and `/service-orders` search
      boxes produces **zero console warnings**, verified in a browser
- [ ] Clearing filters empties the box without touching a DOM node by hand
- [ ] `/service-orders` finds an order by customer name, by phone and by plate,
      proven against **real Postgres**, with the unfiltered row count unchanged
- [ ] The list shows customer and plate, a truncated 8-character ID, and no
      `Descripción`; the detail page still shows the full UUID
- [ ] With no `sort` in the URL, orders read newest-appointment-first and
      orders without an appointment sit last — proven on data where
      `appointmentAt` and `createdAt` disagree, which today's 2 rows do not
- [ ] A vehicle not in the catalog is still recordable via "Otro"
- [ ] Both vehicle write paths offer the same makes and models
- [ ] Completing a `mant_preventivo` or `mant_correctivo` order schedules
      `service_due`; the other three schedule none
- [ ] `npm test` and `npx tsc --noEmit` clean at the end of every unit

## Open question — blocks WU3's spec only

**Which makes and models ship in the first cut.** A candidate list is being
drafted for the owner to **correct, not approve from scratch**; nothing here
invents it. It blocks WU3 alone — WU1, WU2 and WU4 can be specced and built
against an empty catalog module.

Settled, recorded so they are not re-asked: a stored `make`/`model` outside the
catalog renders **as-is** and is never blanked (the stored value outranks the
catalog); search matches name, phone and plate but not `description`; the ID
column stays, truncated.
