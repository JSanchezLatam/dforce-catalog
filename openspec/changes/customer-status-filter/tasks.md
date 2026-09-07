# Tasks: three-state customer status filter

## WU1 — the query, RED first

- [x] 1.1 Four tests on `buildClienteListWhere` before any implementation:
  active by default, ONLY deactivated, neither for `all`, and the state
  surviving alongside a search term. Three went red; the fourth (the default)
  already passed and is a guard, not a claim of new behaviour.
- [x] 1.2 `status` replaces `includeInactive`. The state predicate stays
  OUTSIDE the search branch — the reason the original active filter is there,
  and the bare list is the screen staff actually open.

## WU2 — the chain

- [x] 2.1 Route, page and filter component. `tsc` drove the order: changing the
  type listed every caller that had to move.
- [x] 2.2 13 tests asserting the old contract migrated by PROPERTY, not by
  name — the search debounce, `pendingPushes`, and the external-navigation race
  are still covered, with the select in place of the checkbox.
- [x] 2.3 Base UI prints the raw VALUE in a `<SelectValue />`, so the trigger
  read "active" instead of "Activos" until a render function mapped it. Caught
  by a test; it would have been visible on screen.

## WU3 — GGA round 1 (eight findings, all real)

- [x] 3.1 **A broken e2e that `npm test` cannot run.**
  `full-flow.e2e.test.ts` still asked for `includeInactive=1`, so the retired
  parameter fell back to `active` and the deactivated row it looks for was
  excluded. Its own sibling docstring credits that e2e with catching the
  original "wired into the PAGE but not the route" bug. Fixed and RUN: 47/47.
- [x] 3.2 Two docblocks stacked on one property, the older one stating the
  route "always sends a boolean". Deleted.
- [x] 3.3 The new empty-state branch shipped with **zero coverage** — deleting
  it left the suite green. Two tests now, matching its two siblings.
- [x] 3.4 Five Spanish comments. The language rule is by AUDIENCE: UI strings
  Spanish, comments English. The UI copy was already right.
- [x] 3.5 **377 KB of login binaries rode in on a `git add -A`**, referenced by
  nothing. Same mistake as `.atl/skill-registry.md` two days ago, and the same
  cause. Removed from the PR.
- [x] 3.6 The main spec was edited DIRECTLY, with no change directory. This
  folder is that correction: the delta lives here and applies on archive.
- [x] 3.7 A comment mangled by find/replace, and "Ver desactivados" pointing at
  `status=all` when a real deactivated-only state now exists.

## WU4 — the two fixes the suite structurally cannot see

- [x] 4.1 `Pagination` no longer receives a function from a server component
  (`customers` and `service-orders`), and `ToastProvider`'s portal mounts after
  hydration via `useSyncExternalStore` — not a `useState`+`useEffect` flag,
  which this repo's lint forbids (`react-hooks/set-state-in-effect`).
- [x] 4.2 **NEITHER IS TESTABLE HERE, and that is a third structural blind spot
  worth naming next to AGENTS.md's injected-seam limit.** Measured in both
  directions: reverting either fix leaves the suite GREEN — `page.test.tsx`
  15/15 with the function prop restored, `CustomerImportButton.test.tsx` 10/10
  with the `typeof document` guard back.
  The reason is structural, not a gap someone can close with a better
  assertion: vitest invokes a page as a plain function, so there is no RSC
  SERIALIZATION boundary to violate; and `render()` takes the client snapshot
  directly, never a server render plus `hydrateRoot`, so no hydration can
  mismatch. A green suite says nothing about either class.
  **The verification is a browser.** Both were confirmed there: the console
  went from two errors to none, page 2 loads, and the status filter round-trips.
  When a change touches a Server Component boundary or a portal, open the
  browser — it is the only place these are visible.

## WU5 — GGA round 3

- [x] 5.1 **The predicate this change ADDED had no real-SQL coverage.** The
  e2e only migrated `includeInactive=1` → `status=all`, which takes
  `buildClienteListWhere`'s early return — the path that already existed.
  `isNotNull(cliente.deactivated_at)` executed against Postgres nowhere, while
  the unit test compiled it with no connection and its own docstring said the
  e2e carried the rows. This change IS a `WHERE`; that had to be true rather
  than assumed. One row now asserts only-deactivated AND that the seeded active
  customers are absent, so it cannot pass against a filter returning everything.
- [x] 5.2 R20 gained a MUST with no scenario behind it. Two added: the
  deactivated-only state, and the empty case it brought.
- [x] 5.3 `firstValue` in `service-orders/page.tsx` reverted. The RSC fix there
  is necessary and stays; swapping the query-string idiom alongside it is a
  behaviour change with no test on a page that has none, which AGENTS.md routes
  to a follow-up rather than into this PR. Recorded below.
- [x] 5.4 R19's docstring had ended up above a type alias instead of the
  component it explains.

## Where the design lives

There is no `design.md`, deliberately. This folder was created retroactively as
WU3.6's correction — the code existed before the change directory did — and the
reasoning that would have gone in a design doc is in the delta spec's own
`Rationale` blocks and in WU4.2's note on why neither bundled fix is testable.
Recorded so the next reader does not go hunting for a missing file.

## Gates

- [x] `npm test` — 1279/1279, 90 files
- [x] `npx tsc --noEmit` — clean
- [x] `npm run lint` — 0 errors, 15 warnings (the documented baseline)
- [x] `npm run test:e2e` — 47/47 against a throwaway database

## Known and NOT fixed here

- [ ] **The `status=inactive` empty state can offer a link to another empty
  page.** Over a genuinely empty database it renders "Ningún cliente
  desactivado. Ver los activos" and that list is empty too — the same defect
  the sibling branch guards with `hasDeactivated`. A mirrored `hasActive` guard
  would close it, at the cost of a THIRD count query on a screen that already
  runs two; not worth it in this change, and raised by GGA as such.
- [ ] **`service-orders/page.tsx` still uses `typeof params.x === "string"`**
  for its query-string reads — the idiom the customers twin documents as a bug
  (`?status=a&status=b` arrives as an ARRAY and is dropped, so the page filters
  by "a" while page 2's link carries no filter). `firstValue` is the fix and it
  already exists in that file. Not done here: it changes behaviour on a page
  with no test file at all, so it needs one first.
- [ ] **`Pagination.buildHref` now has zero callers** — a dead union member and
  a dead branch, worth deleting in its own change.
- [ ] **Interfuerza has no vehicle data and no usable address.** Measured live
  across all 371 rows: `Direccion` is filled on 5, `Ciudad` on 9. There is no
  vehicle endpoint the token can reach (`vehicles`/`vehiculos`/`cars`/`autos`
  all 401). `RUC` (74%) and `Birthday` (99%) ARE populated and are currently
  discarded by the mapper — worth importing, and its own change.
- [ ] **Writing back to Interfuerza is possible but undocumented.**
  `PUT/customers` is the one verb the token can reach; the other five answer
  "Not Present for Token". It validates before writing (three probes left the
  count at 371) but rejects every payload shape tried, and guessing field names
  against a production ERP is how this project already lost a rewrite once —
  on READS. Needs the vendor's spec for `PUT/customers`.
