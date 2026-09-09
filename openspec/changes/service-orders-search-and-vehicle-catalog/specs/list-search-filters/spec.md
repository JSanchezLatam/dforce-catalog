# list-search-filters Specification

## Purpose

The shared, controlled, URL-driven search-input contract for list screens.
Cross-cutting by precedent — `table-sorting` and `table-bulk-actions` are
already shaped this way. This capability governs the INPUT'S mechanics
(controlled value, debounce, URL sync, re-seed rules); which columns each
screen's search term matches is owned by that screen's own capability
(`customer-management`, `service-orders`).

Fixes: `CustomerFilters.tsx:158` and `InventoryFilters.tsx:70,80` render
`defaultValue={...}` on inputs whose URL-driven value changes after mount —
an uncontrolled input receiving a changing initial value, which is why the
search itself works but the browser console logs a warning on every
keystroke. The fix is control, not new search logic.

## Requirements

### Requirement: Controlled Search Input Value

Every list-screen free-text filter input driven by URL state MUST be a
React-controlled input (`value` bound to component state), never an
uncontrolled input using `defaultValue`. State MUST seed from
`selected.<field>` on mount and MUST update on every keystroke.

#### Scenario: Initial value matches the URL
- GIVEN a list page loaded with `?search=perez` in the URL
- WHEN the search input first renders
- THEN its displayed value MUST read "perez"

#### Scenario: Typed value renders immediately
- GIVEN an empty search input
- WHEN staff types "pere"
- THEN the input MUST display "pere" without waiting for the debounced URL push

### Requirement: Local State Is Authoritative While Typing; Re-Seed Only On External Navigation

While staff types, the input's local state MUST be the source of truth for
what is displayed — it MUST NOT be overwritten by a prop update caused by the
component's own debounced push landing. The input MUST re-seed its local
state from `selected.<field>` only when that prop changes for a reason other
than the component's own most recent push: an EXTERNAL navigation (browser
back/forward, or a `<Link>` elsewhere in the app).

#### Scenario: Browser back button re-seeds the input
- GIVEN staff typed "perez", and the URL now reads `?search=perez`
- WHEN staff clicks the browser's back button to a prior URL with no `search` param
- THEN the input's displayed value MUST update to empty, matching that URL

#### Scenario: A debounced push carries the latest value, not a stale one
- GIVEN staff types "a", then within the debounce window types "ab"
- WHEN the debounce timer fires
- THEN the value pushed to the URL MUST be "ab", not "a"

### Requirement: Clearing Filters Updates State, Not a DOM Node

A "Limpiar" control MUST clear the search input by updating the same state
its `value` is bound to. It MUST NOT reach into the DOM directly (e.g.
assigning `inputRef.current.value`) to blank the field.

#### Scenario: Clearing empties the input
- GIVEN a search input showing "perez" with an active "Limpiar" control
- WHEN staff clicks "Limpiar"
- THEN the input MUST render empty AND the URL MUST no longer carry that search parameter

### Requirement: Applies Uniformly Across List Screens

Every URL-driven free-text filter input MUST use this contract:
`CustomerFilters`' combined search box, `InventoryFilters`' `id` and `name`
boxes, and `ServiceOrderFilters`' search box (added by `service-orders`).
No list screen MAY keep an uncontrolled `defaultValue` input wired to
URL-driven state.

#### Scenario: Every listed input is controlled
- GIVEN any of `CustomerFilters`, `InventoryFilters` (`id`, `name`), or `ServiceOrderFilters`
- WHEN its search input renders
- THEN it MUST be controlled per the requirements above, with no `defaultValue` bound to URL-driven data

## Verification Notes

The Base UI dev-overlay warning disappearing, and the absence of any browser
console warning while typing, are observable only by opening a browser with
the console visible — jsdom does not run Base UI's dev-mode warning path, so
no automated test reaches this. It is a manual/browser verification step, not
a scenario. `vehicle-catalog` and `customer-management` (WU3) are out of
scope for this file — WU3 is blocked on the owner's make/model corrections
and is not specced here.
