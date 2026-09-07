# Proposal: three-state customer status filter

## Why

The owner reviewed the customers screen after importing 368 Interfuerza
customers and asked for a selector: **activos / desactivados / todos**.

That reads like styling and is not. `ClienteFilters.includeInactive` is a
BOOLEAN — active, or everything — so "only the deactivated ones" could not be
asked for at all. The screen offered a checkbox with two of the three states
that matter, and the missing one is exactly what someone looking for a customer
they retired is after. Before this, they had to switch to "todos" and scan 37
pages of active records to find one deactivated row.

## What changes

- `ClienteFilters.status: "active" | "inactive" | "all"` replaces the boolean,
  in the query, the route, the page and the filter component.
- `GET /api/customers` accepts `status` instead of `includeInactive`. An
  unrecognised value falls back to `active` rather than throwing, so an old
  bookmarked link renders the normal list instead of a 500.
- The filter bar: label `Filtro`, placeholder `Buscar por nombre, placa o
  teléfono`, and the three-state select.
- The empty state gains its own branch for `status=inactive` — without it, a
  deactivated-only filter over 368 active customers said "Todavía no hay
  clientes registrados", which is false.
- "Ver desactivados" now opens `status=inactive`. It used to open a mixed list
  because a deactivated-only one could not be expressed.

## Two production fixes that rode in, and why they are here

The owner reported "tengo un error" after restarting. It was not the restart:
importing 368 customers made the list 37 pages, which mounted `Pagination` for
the first time in this database's life and exposed two defects that had been
sitting there for months.

They are in this change because they are what made the screen render at all —
reviewing a filter bar on a page that throws is not possible. They are NOT the
filter, and they are listed separately for that reason.

- **A function crossing the server/client boundary.** `customers/page.tsx` and
  `service-orders/page.tsx` passed `buildHref={(p) => ...}` to `Pagination`,
  which is `"use client"`. Next.js refuses and the page does not render.
  Shipped in Phase 6; invisible because `Pagination` returns `null` at
  `pageCount <= 1` and this database held ONE customer. Fixed with
  `hrefPattern`, the serializable variant that already existed.
- **A hydration mismatch in `ToastProvider`**, whose portal sat behind
  `typeof document !== "undefined"` — React's own documented cause #1.

Also carried, and equally not the filter: the button reads **Sincronizar
clientes** instead of Importar (it is a repeatable upsert, and the old label
undersold it), and the page gained a description under its heading. Both were
asked for in the same review.

## What does NOT change

The exclusion still lives in `buildClienteListWhere`, outside the search
branch, so the picker inherits it — R20's structural guarantee is untouched.
Nothing about vehicle soft-delete moves: asking to see a retired CUSTOMER is
still not asking to search the plates of cars they no longer own.
