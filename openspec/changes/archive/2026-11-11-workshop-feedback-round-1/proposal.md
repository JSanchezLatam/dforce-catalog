# Workshop feedback, round 1

## Why

The app went into real use on the workshop's Windows PC on 2026-09-12. This is
what the owner hit in the first days, plus two defects found while
investigating them. It is a batch of mostly independent fixes, not one feature,
so it is tracked as a work queue rather than specced as a single change.

## How this is grouped, and why not by module

The obvious split is by module — inventory, service orders, catalogs. **That
split does not survive measurement.** Two items named after one module change
code four to seven screens share, and two items named after different concerns
land in the same file.

The grouping in `tasks.md` follows what was measured, not what the items are
called. Every constraint below was checked against the code; none is inferred.

### Measured collisions — same file, cannot be parallel

| Fact | Evidence |
|---|---|
| The catalog selection UI and the live preview are the same 809-line file | `CatalogBuilderForm.tsx` — selection at :447-702, preview at :737 |
| The service-orders refresh button and the 1000-row inventory load are the same file | `src/app/(app)/service-orders/page.tsx` |

### Measured blast radius wider than the item's name

| Item as reported | What it actually touches |
|---|---|
| "Inventory: search is lost when going back" | `src/shared/ui/filters/useUrlFilters.ts` — used by inventory, customers, service orders and the vehicle make/model picker |
| "The sync badge is not the same size as the button" | `src/shared/ui/StatusBadge.tsx` — used by catalogs, inventory sync, users, service orders (list and detail), customers and vehicles |

Neither is a change to the module that reported it. Both get their own PR for
that reason: a regression from either shows up somewhere nobody was looking.

### Measured as independent

`inventory/[id]/page.tsx` (price lists), `policy.ts` + `catalogs/page.tsx`
(permissions), `customers/validation.ts` + `account/service.ts` (Spanish
messages), and `CatalogTemplate.tsx` (page space) share no files with each
other or with anything above.

## Two things that are the owner's decision, not a defect

- **Catalog visibility.** `tecnico` has `catalogs.read: true` and
  `catalogs.download: true` but `catalogs.generate: false` and
  `catalogs.listAll: false` (`policy.ts`), and the page shows only catalogs
  whose `userId` matches (`catalogs/page.tsx:23`). A técnico can therefore never
  generate one and never see anyone else's: the screen is empty by
  construction and those two `true` grants do nothing. The question behind the
  fix is whether a catalog is a personal document or a workshop asset.
- **Page space distribution.** The empty bottom of a 6-per-page sheet is the
  product of a deliberate, documented bias: the measurement over-counts on
  purpose because *"overflowing is the bug, a slightly emptier page is not"*
  (`worker.ts:116-145`), and `productsPerPage` is a maximum, not a target
  (`openspec/specs/catalog-generation/spec.md:43-47`). Distributing the leftover
  space is compatible with that; making more products fit is not.

## Out of scope

A progress bar for catalog generation. There is no progress data — only
`pending -> uploading -> uploaded | failed` — so a bar would animate without
measuring anything. Ruled out by the owner on 2026-09-13 in favour of the
completion notice, which shipped.
