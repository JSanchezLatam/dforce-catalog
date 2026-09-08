# Design: Table Column Sorting

## Technical Approach

Sort is URL state on `/customers`, `/inventory`, `/service-orders` and component state on
`/users`. Each query module gains a pure `parse*Sort()` beside the existing
`parsePageSize`/`computePageWindow` (`inventory-view/queries.ts:61-75`) returning a Drizzle
order value, composed into the `.orderBy()` slot that already precedes `.limit()/.offset()`.
Headers become `<Link>`s built from a serializable href inside the Server Component. No shared
hook, no shared component, `table.tsx` untouched.

## Architecture Decisions

### D1 — The header control is a `<Link>`. The proposal's `<button>` constraint yields.

Three pieces of in-repo evidence, not preference:

1. `customers/page.tsx:266-278` — a Server Component cannot hand a function to a client
   component. That defect shipped and hid for months because `Pagination` returns `null` at
   `pageCount <= 1`. The fix was a serializable **string** (`hrefPattern`), not a new boundary.
2. `CustomerFilters.tsx:94-102` — `commit()` is deliberately the *only* `router.push` on
   `/customers`; `pushedParamsRef` is what makes the debounce safe. A separate client sort
   header pushing on its own is exactly the second writer that comment exists to forbid, and
   its failure mode (debounce rebuilds from a stale ref and stomps the sort) is the bug that
   shipped **twice** on that file.
3. `customers/page.tsx:225-234` — this repo already measured and decided that a navigation
   renders as an anchor: a button "announces a navigation as a button and drops it out of the
   links list."

A sort *is* a URL. `<Link>` matches `Pagination.tsx:61,77`, which `page.test.tsx:130-142`
already asserts via `getAllByRole("link")`.

**Given up**: no `<button>` — the spec must say `<a>`. `aria-sort` is unaffected; it is a `th`
attribute on `TableHead`, orthogonal to the child element type. Works with JS off.

**Rejected**: a client header component per table. Consistent with `<button>`, but it adds a
boundary to the file whose boundary bugs are documented, duplicates each Filters' param parse
via `useSearchParams`, and on `/customers` introduces the forbidden second writer.

### D2 — One whitelist const per query module; the page imports it.

`customers/queries.ts` exports `CLIENTE_SORT = { name: cliente.name, phone: cliente.phone,
email: cliente.email }` and `parseClienteSort(params): { key, dir } | undefined`. The page
imports `CLIENTE_SORT` to decide which headers link. One object means query and page cannot
disagree, and **dropping `plates` is deleting one key**.

### D3 — Later extraction stays cheap without building it now.

`InventoryFilters.applyFilter:38-44` and `ServiceOrderFilters.applyFilter:29-35` are already
byte-identical in behaviour; `CustomerFilters` differs only in its params source. Because sort
is a `<Link>` (D1), **no Filters component is touched at all** — the duplication is confined to
the three `parse*Sort` functions, which share one signature `(searchParams) => Sort | undefined`
and one `dir` parser. Extract only when a fourth caller appears.

### D4 — `.orderBy()` composition preserves the injected-`queryFn` seam.

`listClientes(filters, window, sort?, queryFn?)` — `sort` is positional **before** `queryFn`,
and `undefined` reproduces today's `desc(cliente.createdAt)`. `api/customers/route.ts:30-83`
never passes it, so `CustomerPicker` is byte-identical with the route unedited.

### D5 — Collation: the two can disagree, and it is unobservable.

`/users` sorts client-side with `localeCompare("es")`; the three server tables inherit the DB
collation. They render different tables and are never compared side by side. WU1 measures
`lc_collate` once against the throwaway DB: if it is `C`, accented names sort after `Z` on
`/customers`, which *is* visible, and the one-line fix is `ORDER BY unaccent(col)` — the
extension is already enabled (migration 0012, `queries.ts:37-48`). `unaccent()` being STABLE
blocks an index, not an `ORDER BY`.

## Data Flow

    TableHead ──<Link href=?sort=name&dir=asc>──→ Server Component
                                                       │ parse*Sort (pure, whitelist)
                                                       ↓
                                        list*(filters, window, sort) ──→ .orderBy → .limit/.offset

## File Changes

| File | Action | Description |
|---|---|---|
| `src/modules/customers/queries.ts` | Modify | `CLIENTE_SORT`, `parseClienteSort`, optional `sort` arg |
| `src/app/(app)/customers/page.tsx` | Modify | `buildSortHref` beside `buildPageHrefPattern`; header `<Link>`s + `aria-sort` |
| `src/modules/inventory-view/queries.ts` + `inventory/page.tsx` | Modify | Same shape, replaces hardcoded `asc(producto.name)` |
| `src/modules/service-orders/queries.ts` + `service-orders/page.tsx` | Modify | Same shape |
| `src/modules/account/UsersTable.tsx` | Modify | `useState` sort beside `showInactive`; `<button>` here (already client) |
| `src/app/api/customers/route.ts`, `src/components/ui/table.tsx`, all three `*Filters.tsx` | **Unchanged** | Consequence of D1/D4 |

## Interfaces

```ts
export const CLIENTE_SORT = { name: cliente.name, phone: cliente.phone, email: cliente.email } as const;
export type ClienteSort = { key: keyof typeof CLIENTE_SORT; dir: "asc" | "desc" };
export function parseClienteSort(p: SearchParams): ClienteSort | undefined;
```

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit (node) | `parse*Sort` whitelist + garbage fallback | RED test per module, mutation-verified |
| Component (jsdom) | header href carries filters/`pageSize`, drops `page`; `aria-sort` on the active column | `getAllByRole("link")`, the `page.test.tsx:130-142` idiom |
| Component | `/users` in-memory sort + `localeCompare("es")` | `UsersTable.test.tsx` |
| Real SQL | the `.orderBy()` line the seam hides | Throwaway native Postgres per unit — Docker is broken; also settles `plates` and `lc_collate` |

`/users` is the one table where the control **is** a `<button>` — `UsersTable` is already
`"use client"` with no URL to navigate to.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or
process-integration boundary. The one untrusted-input surface (`?sort=`) is closed by the D2
whitelist, which carries its own RED test.

## Migration / Rollout

No migration. Every unit is additive and independently revertable; a stale
`?sort=…` renders the default order.

## Open Questions

- [ ] `plates` orderability under Drizzle — WU1 tries `.orderBy(sql\`plates\`)` against the
      throwaway DB. Ship only if it executes **and** array-lexicographic order reads sensibly;
      otherwise delete the key (D2).
- [ ] NULLS FIRST/LAST for `appointmentAt` — `sdd-spec` owns the choice; do not inherit the
      Postgres default silently.
