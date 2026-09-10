# Tasks: Service Order Search, Legible Order Rows, and a Curated Vehicle Catalog

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~1,180 (WU1 ~250, WU2 ~350, WU3 ~500, WU4 ~80). ~300 of WU3's are data rows — see Phase 3 |
| Review budget | 800 lines per PR |
| 800-line budget risk | Low per unit |
| Chained PRs recommended | Yes — for WU1 → WU2 only |
| Chain strategy | feature-branch-chain (repo convention) |

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Shared controlled search input (`useUrlFilters` + `SearchFilterInput`); rewire `CustomerFilters`, `InventoryFilters` (×2 inputs), `ServiceOrderFilters`; delete `searchInputRef` and the two stray `router.push`es (D1–D6) | PR 1 (base: tracker) | `npx vitest run useUrlFilters CustomerFilters InventoryFilters ServiceOrderFilters` | jsdom tests + **browser, console open** — the Base UI warning must be gone, `/inventory`'s two-field drop must be gone, back-button re-seeding must work | Reverting restores three uncontrolled inputs, the console warning, and `/inventory`'s stale-closure race — nothing persisted changes |
| 2 | `cliente`/`vehiculo` joins, search `WHERE`, narrowed `OrdenServicioListItem`, column set, ID truncation, new default order, URL builders (D7–D11) | PR 2 (base: PR 1) | `npx vitest run service-orders/queries service-orders/page text-search` | **e2e against real Postgres, required** — the join is unproven by any green unit suite | Reverting restores `db.select().from(ordenServicio)` and `desc(createdAt)`; no migration, no write path, no row affected |
| 3 | Curated vehicle catalog + the shared make/model control with its "Otro" escape, on both write paths (D13–D20) | PR 4 (base: tracker) | `npx vitest run vehicle-catalog VehicleMakeModelFields VehicleQuickForm CustomerForm` | node shape test over ~300 data rows + jsdom on the shared control and both forms + **browser, console open** — no test here measures a height or sees a hydration mismatch | Reverting deletes two new files and restores four `Input`s; `make`/`model` stay plain nullable `text`, so every stored value — catalog or free-text — remains valid with no data repair |
| 4 | `service_due` restricted to `mant_preventivo`/`mant_correctivo` (D12) | PR 3 (base: tracker) | `npx vitest run reminders/schedule` | node tests, all five categories asserted by name | Reverting restores the reminder for all five categories; already-written `reminder` rows are untouched |

```
tracker (draft, no-merge)
  ├── 1 shared search input ── 2 order list join + search + columns
  ├── 3 vehicle catalog
  └── 4 reminder category condition
```

WU1 → WU2 is the only real dependency. WU4 touches disjoint files
(`reminders/schedule.ts`, `schedule.test.ts`) and can land before, after, or
interleaved with the 1→2 chain. WU3 is likewise disjoint — it touches only
`customers/vehicle-catalog.ts`, `VehicleMakeModelFields.tsx`,
`VehicleQuickForm.tsx` and `CustomerForm.tsx`, none of which WU1, WU2 or WU4
opens — so it can land in any order too.

## Gates, every unit

- `npm test` (run alone — this machine produces phantom timeouts when suites
  overlap) and `npx tsc --noEmit` clean before opening that unit's PR.
- `gga run --pr-mode --diff-only` (`GGA_TIMEOUT=900`, pin `PR_BASE_BRANCH` to
  the previous unit's branch — `--pr-mode` auto-detect resolves to `main` on
  a chained branch).
- `gentle-ai review status --contract gentle-ai.review-integration/v2 --agent
  <runtime> --next-transition` before delivery.
- Every task marked **mutation-verify** ends with a `diff` proving the swap
  actually landed before trusting the red result, then a second `diff` after
  reverting, confirming byte-identical. `sd` exits 0 on no match and no-ops
  on multiline patterns — prefer targeted edits or Python line edits over a
  broad regex for a mutation.
- Every unit gets a **browser check with the console open** — WU1's is the
  only evidence Base UI's dev-mode warning path (invisible to jsdom)
  disappears; WU2's is column/layout evidence a join-shaped unit test cannot
  give.
- Test-helper object keys stay English even where the assertion string is
  Spanish (language split by audience, not by file — caught twice in review
  on the previous change).

---

## Phase 1 — Shared controlled search input, and the two defects it fixes
(list-search-filters spec: all four requirements; design D1–D6)

- [x] 1.1 RED (jsdom) create `src/shared/ui/filters/useUrlFilters.test.tsx` —
  move the `next/navigation` mock (`pending`, `listeners`, `land`, `push`,
  all `vi.hoisted`) and the three race describes (`the debounce must not
  clobber`, `Limpiar goes through the same writer`, `two pushes
  outstanding`) from `CustomerFilters.test.tsx:23-77,188-288` verbatim per
  D3, rewritten against a tiny test harness component that calls
  `useUrlFilters` directly and renders `text`/`applyFilter`/`clearAll`
  through plain inputs/buttons — not through `CustomerFilters`. Confirm
  every test fails: the module does not exist yet.
- [x] 1.2 GREEN — create `src/shared/ui/filters/useUrlFilters.ts` per the
  design's Interfaces block (`text`, `setText`, `applyFilter`, `clearAll`).
  Move `pushedParamsRef`, `pendingPushes`, `commit()`'s changed-URL guard, and
  `applyFilter` reading `pushedParamsRef.current ?? window.location.search`
  verbatim from `CustomerFilters.tsx:73-131` (D3). `initialText` seeded via
  lazy `useState(() => initialText)` (D3 "Seeding" — never re-seeds mid-typing
  off a rebuilt object literal).
- [x] 1.3 GREEN — per-key debounce: `useRef<Map<string, Timeout>>`, not the
  single `debounceRef` every screen has today (D4); `clearAll` iterates the
  map.
- [x] 1.4 GREEN — add the one new line inside the existing
  `useEffect([searchParams])`: `wasOurs = pendingPushes.current > 0`, read
  BEFORE the decrement; re-seed `text` from `useSearchParams()` only when
  `!wasOurs` — D3's exact snippet.
- [x] 1.5 RED (jsdom), same file — an external-navigation re-seed test
  (browser back to a URL with no params re-seeds `text` to empty) and a
  same-navigation-non-reseed test (the hook's own push landing mid-debounce
  does NOT reseed) — the two branches of D3's `wasOurs` line, neither
  expressible as a hook-level test before this unit. Confirm both pass once
  1.2–1.4 land (this is the checkpoint, not new implementation).
- [x] 1.6 **Mutation-verify D3's binding claim** — revert the `wasOurs`
  guard (make the effect always re-seed, or never re-seed). Confirm 1.5's
  re-seed test goes red **by name**. `diff` to confirm the mutation landed,
  then a second `diff` after reverting, confirming byte-identical.
- [x] 1.7 GREEN — create `src/shared/ui/filters/SearchFilterInput.tsx`:
  `Label` + controlled `Input`, `value`/`onValueChange`, **no `defaultValue`
  prop in the type at all** (D1 — "the prop does not exist"), per the
  Interfaces block.
- [x] 1.8 GREEN — rewire `CustomerFilters.tsx`: delete `debounceRef`,
  `pushedParamsRef`, `pendingPushes`, `searchInputRef`, `commit`,
  `applyFilter`, `clearFilters`, `applyDebounced` (all now in the hook); call
  `useUrlFilters({ search: selected.search ?? "" })`; render
  `<SearchFilterInput id="filter-search" label="Filtro" placeholder="Buscar por nombre, placa o teléfono" value={text.search} onValueChange={(v) => setText("search", v)} />`;
  status/pageSize selects keep calling the hook's `applyFilter`; `Limpiar`
  calls `clearAll`.
- [x] 1.9 GREEN — confirm `searchInputRef` and the hand-written DOM write at
  the old `:141` (`searchInputRef.current.value = ""`) are gone:
  `rg searchInputRef src/modules/customers/CustomerFilters.tsx` returns
  nothing (D3 — "the ref's disappearance is the proof the input became
  controlled").
- [x] 1.10 RED/GREEN `CustomerFilters.test.tsx` — confirm the surviving
  status/compose tests (Activos default, Desactivados, Todos, keeps an
  active search term, page reset, Limpiar visibility, Limpiar empties the
  box) all still pass against the rewired component, unmodified in
  assertion.

  > **Finding (sdd-apply):** 1.1 says move the WHOLE "Limpiar goes through
  > the same writer" describe (all 3 its) to `useUrlFilters.test.tsx`; this
  > task's own "surviving" list names "Limpiar empties the box" as staying in
  > `CustomerFilters.test.tsx`. Kept it in BOTH: the hook-level version (moved
  > verbatim, asserting the harness input) proves the mechanism; the
  > component-level version (new here, same assertion shape, against the real
  > `CustomerFilters`) proves the `SearchFilterInput` wiring is actually
  > controlled — that is component-specific and no hook-level test can give
  > it. The other two its under that describe (writer-identity, pending-timer
  > cancellation) moved out and are not duplicated.
- [x] 1.11 `npx vitest run useUrlFilters CustomerFilters` — every test from
  1.1–1.10 green.

- [x] 1.12 RED (jsdom) create `src/modules/inventory-view/InventoryFilters.test.tsx`
  (does not exist today — checked directly, only `CustomerFilters.test.tsx`
  exists). Assert `#filter-id` and `#filter-name` are controlled (`value`
  bound, no `defaultValue`). Reproduce the reported defect **by its exact
  shape**: type `ABC` into `#filter-id`, then within the debounce window type
  `bateria` into `#filter-name`; after the debounce settles, the URL MUST
  carry **both** `id=ABC` and `name=bateria` — not a generic debounce test.
  Confirm it fails against current `InventoryFilters.tsx` (one shared
  `debounceRef`, `applyFilter` built from `searchParams.toString()`).
- [x] 1.13 GREEN — rewire `InventoryFilters.tsx` onto
  `useUrlFilters({ id: selected.id ?? "", name: selected.name ?? "" })` +
  two `SearchFilterInput`s; delete `applyFilter`'s stale-closure read
  (`searchParams.toString()`, D2's "reverted attempt #1, still shipping")
  and `pushParams`; delete the second `router.push(pathname)` `Limpiar`
  button (`:140`), replace with the hook's `clearAll()` behind
  `Button variant="outline" size="default"` (D6 — stays `h-8`, filter-strip
  exception, no `min-h-11`).
- [x] 1.14 RED/GREEN — `Categoría 1`/`Categoría 2`/`Stock` selects still call
  `applyFilter` immediately, unchanged; `pageSize` change does not drop
  `page`, any other filter change does (D5 — `/inventory`'s existing
  behavior, confirm unchanged by the rewire).

  > **Finding (sdd-apply):** this task's literal wording ("pageSize change
  > does NOT drop page") contradicts both D5's own text ("Chosen: always
  > delete `page`... `/inventory` is unchanged") and the pre-change code:
  > `InventoryFilters.tsx`'s old `setPageSize` already called
  > `params.delete("page")` unconditionally, on every `pageSize` change.
  > Implemented per D5 + the actual prior behavior (page dropped on every
  > filter change, `pageSize` included) and added a test asserting exactly
  > that (`a pageSize change also drops page, same as every other filter`),
  > not the task's literal (backwards) wording.
- [x] 1.15 **Mutation-verify D2/D4's binding claim — the fix this unit exists
  for.** Revert `InventoryFilters` to a single shared timer (or reintroduce
  `searchParams.toString()` as the read source). Confirm 1.12's two-field
  test goes red **by name**. `diff` to confirm, then revert and confirm
  green.

- [x] 1.16 RED (jsdom) create `src/modules/service-orders/ServiceOrderFilters.test.tsx`
  (does not exist today — checked directly). For the status `Select` and
  `pageSize` `Select` only (the search box arrives with WU2, D1 names this
  screen "the fourth call site"); assert `Limpiar` goes through the hook's
  `clearAll`, not its own `router.push(pathname)` (`:58`).
- [x] 1.17 GREEN — rewire `ServiceOrderFilters.tsx` onto `useUrlFilters({})`
  for `applyFilter`/`clearAll`; no `SearchFilterInput` yet — the point of
  this task is that status/pageSize/`Limpiar` route through the ONE hook so
  WU2's search box cannot become a second writer on this screen.

  > **Finding (sdd-apply):** 1.16 is labeled RED, but no real RED exists here.
  > With no debounce on this screen yet (no search box until WU2), a
  > standalone `router.push(pathname)` Limpiar and the hook's `clearAll()`
  > produce an IDENTICAL observable URL, so a black-box URL assertion cannot
  > distinguish them — confirmed by implementing the standalone-writer version
  > first and observing the test stayed green. Applied the AGENTS.md
  > Strict-TDD retrofit carve-out instead (same class as 2.2): built the real
  > `clearAll()` version, then temporarily reinstated a standalone
  > `router.push(pathname)` writer and confirmed the test still passed (i.e.
  > it is not yet meaningful as a writer-identity check), then reverted. The
  > claim this task exists to protect only becomes testable once WU2 adds a
  > debounced search box to this screen (task 2.25) and a race can exist.

- [x] 1.18 `diff` every created/touched file (`useUrlFilters.ts`,
  `SearchFilterInput.tsx`, `CustomerFilters.tsx`, `InventoryFilters.tsx`,
  `ServiceOrderFilters.tsx`, and their tests) before trusting 1.1–1.17.
- [x] 1.19 **Browser check, both themes, console open — the only evidence
  that exists for this unit's actual defects.** jsdom does not run Base
  UI's dev-mode warning path. On `/customers`, `/inventory`,
  `/service-orders`: type in every search box and confirm **zero console
  warnings** (the "changing the default value state of an uncontrolled
  FieldControl" message must not appear); on `/inventory`, type `ABC` then
  `bateria` within ~1.2s and confirm the URL carries both terms (the
  reported defect, reproduced live); browser back/forward re-seeds every
  box; `Limpiar` empties the box with no DOM write.
- [x] 1.20 `npm test` (alone) and `npx tsc --noEmit` clean.

### Phase 1 verification record — fill in during `sdd-apply`

| Task | Evidence |
|---|---|
| 1.6 | Reverted `wasOurs` guard to unconditional `reseedTextFromSearchParams()` in `useUrlFilters.ts`. `useUrlFilters — re-seed only on external navigation > does not re-seed when its own push lands while typing continues` went RED by name (value `ana` expected, received empty). `diff` confirmed the mutation landed; reverted; second `diff` confirmed byte-identical; suite green again (7/7). |
| 1.15 | Reverted per-key `timers` Map to a single shared-key timer in `useUrlFilters.ts` (the class of bug D4 exists to prevent, now centralized in the hook rather than duplicated per screen). `InventoryFilters — two text fields must not clobber each other (D4) > keeps BOTH id and name after typing into id, then name, inside the debounce window` went RED by name — `/inventory?name=bateria` only, `id=ABC` dropped, reproducing the exact reported defect shape. `diff` confirmed the mutation landed; reverted; second `diff` confirmed byte-identical; suite green again (7/7). |
| 1.19 | **Run by the orchestrator** against the owner's dev server on `:3000` with real data — see the WU1 verification record below for what was measured. The implementing agent could not: jsdom does not execute Base UI's dev-mode warning path (AGENTS.md's second known limit) and it has no browser. |
| 1.20 | **Final run by the orchestrator after two GGA rounds**: `npm test` 1576/1576 · `npx tsc --noEmit` clean · `npm run lint` 0 errors / 14 warnings. (The implementing agent's own pre-GGA run was 1572 — the four added tests are the GGA findings' REDs.) |

---


### WU1 verification record — what was actually run, and where

jsdom does not execute Base UI's dev-mode warning path, so no test in this repo
can say the red overlay is gone. This is that evidence, run against the owner's
own dev server on `:3000` with its real data (370 customers, 699 products).

| Check | Result |
|---|---|
| **The reported defect** | `/customers`, typing `jorge`: filters correctly, **the red "1 Issue" badge is gone**, 0 console errors. It was present on the same screen, same term, before this unit. |
| **`/inventory`'s silent filter drop** | Re-ran the exact measurement that found it: `ABC` into `#filter-id`, `bateria` into `#filter-name` 120 ms later. URL is now **`?id=ABC&name=bateria`** — both survive. Before: `?name=bateria`, the ID gone while the box still showed it. |
| **The re-seed branch (D3)** | Back button from `?id=ABC&name=bateria` → `?id=ABC`: the ID box keeps `ABC`, the name box clears to match the URL. An external navigation re-seeds; our own push does not. |
| Console | 0 errors on both screens. |

Gates: `npm test` 1572/1572 · `npx tsc --noEmit` clean · `npm run lint` 0
errors / **14** warnings — one FEWER than the documented baseline, because
`InventoryFilters`' hand-styled `<button>` became a shadcn `Button`. Verified
by diffing the warning set against `main`: the file that dropped out is
`InventoryFilters.tsx`. `AGENTS.md`'s count was corrected in this unit rather
than left to read as a regression by the next person.

Both mutations were re-run independently of the implementing agent:
`timers.current.get(key)` → a shared key turns **`keeps BOTH id and name after
typing into id, then name, inside the debounce window`** red by name; dropping
the `if (!wasOurs)` guard turns **`does not re-seed when its own push lands
while typing continues`** red by name. Each `diff`-proved on the way in and
byte-identical on the way back.

**Task 1.16's test stays green under its mutation, and that is recorded rather
than papered over.** `/service-orders` has no debounce yet — its search box is
WU2 — so a standalone `router.push(pathname)` and the hook's `clearAll()`
produce an identical URL, and no black-box assertion can tell them apart. It
becomes checkable once WU2 adds that screen's search box, and the task says so.

**GGA round 1 found a defect in the fix itself, and it is the one worth
naming.** `clearAll` emptied the whole key set (`setTextState({})`), while the
re-seed rebuilds over the keys already in state — so one click of Limpiar
disabled re-seeding permanently: Back then returned a list filtered by `perez`
with the box sitting empty. **That is this change's own defect class**, screen
disagreeing with the list it produced, and it would have shipped in shared code
on three screens. The existing re-seed test could not catch it because it never
cleared first. Fixed by keeping the keys and emptying the values, with a RED
that clears before going back; mutation-verified.

Two more from the same round. A test named *"bound via value not
defaultValue"* asserted `not.toHaveAttribute("defaultValue")`, which is
**vacuous** — React maps `defaultValue` onto the `value` attribute, so it
passes for an uncontrolled input too, and the test proved neither half of its
own name. Replaced with a behavioural one: type, then assert the box reflects
the keystroke before any push has landed. Mutation-verified — restoring
`defaultValue` on the input turns it red. Its sibling was renamed for the same
reason: it never made that claim, only promised it.

And the debounce timer had no unmount cleanup, so typing and then clicking a
sidebar link inside the window pushed the operator back off the page they had
just navigated to. Pre-existing in `CustomerFilters` and moved here — closed
now precisely because this is one path serving three screens instead of one
screen's private bug.

**GGA round 2 — three more, and one of them was a false record.**

`Limpiar` on `/inventory` derived `disabled` from `selected` alone — the
SERVER's view, which lags a keystroke by the whole debounce. So the button was
disabled in exactly the 300ms window `clearAll` exists for: type `bater`, click
Limpiar, the click is a no-op, and the timer then filters by the term the
operator just tried to cancel. `clearAll` is the only thing here that cancels a
pending timer, so it must stay reachable while one is pending. The old
hand-styled `<button>` was always clickable; the real `disabled` state added by
this unit is what introduced the block, one line below the fix it disabled.

The re-seed effect also ran on MOUNT with the counter at zero, so it read the
first render as an external navigation and overwrote the lazily-seeded
`initialText` with raw `searchParams`. On `/inventory?id=A&id=B` the page's
`typeof params.id === "string"` guard leaves the list UNFILTERED while
`searchParams.get("id")` answers `"A"` — the box showing a filter that is not
applied. The same class again, reintroduced by the fix for it.

**And two tasks belonging to OTHER units were ticked with no artifacts behind
them**: 2.1 claimed `src/shared/db/text-search.ts` existed and 4.1 claimed
`schedule.test.ts` had gained a `categoria` override. This branch touches no
file under `shared/db/` or `reminders/` at all. AGENTS.md is explicit that SDD
task state lives in committed files — whoever picked up WU2 or WU4 would have
read those boxes and skipped the work. Unticked.

Both code fixes carry their own RED, mutation-verified: dropping `text.id ||
text.name` from the enable condition turns *keeps Limpiar reachable while a
debounce is pending* red, and dropping the mount guard turns *does not
overwrite the caller's value with a duplicated URL param on mount* red.

**GGA round 3 — and the first finding is the reason a third round was worth
running.** Round 2's `Limpiar`-reachability fix landed on `/inventory` ONLY.
`/customers` still gated its button on `selected` alone, so the identical
defect stood on the screen the owner actually reported — one caller patched,
the shared cause left alone, which is the failure the hook exists to prevent.
`ServiceOrderFilters` had the same gate, harmless only until WU2 gives it a
search box. Fixed once, in the hook: `hasTypedText` is derived there and no
call site can forget it.

**The mount guard did not survive StrictMode.** It was a `useRef(false)`
flipped on first run — but React 19 runs mount → cleanup → mount and a ref is
not reset by a cleanup, so the second pass found it already `true` and the
re-seed fired. Next 16 defaults `reactStrictMode` to true, so the guard had
stopped guarding **in dev, which is exactly where this repo's browser checks
happen**, while RTL's plain `render()` could not see it. It now compares the
`searchParams` object itself, which a remount cannot fool, and the regression
test renders inside `<StrictMode>`.

D5's "drop `page` on every filter change" is a behaviour change on `/customers`
and `/service-orders` — and the only assertion for it was on `/inventory`, the
one screen whose behaviour did not change. Covered on both now;
mutation-verified by restoring the old `if (key !== "pageSize")`.

And a test named *"…not a standalone router.push"* could not check that clause:
`/service-orders` has no debounce to cancel until WU2, so both writers produce
an identical URL. Renamed to what it proves, and tightened to assert exactly
one push.

**GGA round 4 — the same lesson a third time, worth naming as a pattern rather
than an incident.** The StrictMode fix guarded the MOUNT; the re-seed path
itself was untouched, so the duplicated-param overwrite still fired on every
Back or `<Link>` — the far more common trigger. Three rounds running, a fix
landed on the narrow case while the shared one stood: `/inventory` patched and
`/customers` left, then the call sites patched and the hook left, now the mount
guarded and the re-seed left.

Fixed where it belongs: `reseedTextFromSearchParams` reads `getAll` and keeps a
value only when there is exactly one, mirroring the `typeof params.x ===
"string"` guard every page already applies. The mount guard is now
belt-and-braces rather than the only defence, and the RED is an external
navigation instead of a mount.

The params comparison moved from identity to VALUE — `useSearchParams()`
returning a fresh object for an unchanged URL (an RSC revalidation) would read
as a navigation and re-seed over text being typed. Unproven against Next 16 and
possibly unreachable; taken because it costs a string compare and cannot
regress the StrictMode case it replaced.

Two nits closed: the D5 `pageSize` test uses `findByRole` for Base UI's
portalled popup, and `ServiceOrderFilters`' structurally-false `hasTypedText`
operand carries a comment saying WU2 makes it live so nobody deletes it.

**GGA round 5 — and this record has to be honest about what was NOT proven.**

The push counter skipped a push whose target equalled `window.location.search`.
Its own comment called that "precision, NOT a fix for a demonstrated bug", and
that was true while it only gated `pushedParamsRef`. It stopped being true the
moment the same counter also gated the re-seed: `window.location` LAGS, because
Next 16 runs `pushState` from an effect after the RSC payload lands, so a
second push aimed back at the still-displayed URL goes uncounted while very
much producing its own commit. That commit then reads as EXTERNAL and rebuilds
the box from the URL — under the operator's cursor.

The tally is replaced by matching the incoming params against the list of
pushes we actually have outstanding, projected against where the ROUTER is
heading rather than against a URL that cannot answer yet. That is exact in any
landing order and consults `window.location` not at all.

**GGA reported reproducing the wipe in `CustomerFilters.test.tsx`. Four honest
attempts to reproduce it at the hook level failed** — driving both pushes
inside one `act` with `fireEvent`, typing before either commit, and probing the
pushes and `window.location` to confirm the window genuinely opens (it does:
`["/list", "/list?status=all"]` with `loc` still `?status=all` at the second
push). The fix is therefore taken on the MECHANISM, which is documented in this
file twenty lines above the guard it removes, and not on a red of my own. The
test that ships pins the two-outstanding-pushes case; it is a regression pin,
not the reproduction, and calling it one would be the placebo this repo keeps
catching.

D5's `pageSize` assertion was missing on `/service-orders` — of the two screens
whose behaviour changed, one was covered and the other left, the same shape as
rounds 2 and 3. Added, mutation-verified. Its combobox is selected by render
order because Base UI gives these `Select`/`Label` pairs no accessible name
without `htmlFor`/`id`.

## Phase 2 — Order list search, columns, and default order
(service-orders spec: *Order List Search Matches Customer, Vehicle, and
Phone*, *Order List Columns Show Customer and Vehicle*, *Unsorted Default
Order Is Appointment-First*; table-sorting spec: both MODIFIED requirements;
design D7–D11)

- [x] 2.1 GREEN (mechanical move, no dedicated test exists today — D8) —
  create `src/shared/db/text-search.ts`, move `unaccentIlike` verbatim,
  including its STABLE-not-IMMUTABLE docstring, from
  `customers/queries.ts:46-48`; export it; `customers/queries.ts` imports it
  instead of declaring it locally. `rg "function unaccentIlike" src/modules/customers/queries.ts`
  returns nothing afterward.
- [x] 2.2 Retrofit test (AGENTS.md's Strict-TDD carve-out — no real RED is
  possible on a pure relocation) — create `src/shared/db/text-search.test.ts`
  asserting `unaccentIlike(cliente.name, '%x%')` renders SQL containing
  `unaccent(` twice and `ilike` once, via `PgDialect().sqlToQuery()` (the
  idiom `service-orders/queries.test.ts:112` already uses). Verify it is
  meaningful: temporarily change `ilike` to `like` in the implementation,
  confirm the test fails, then revert.
- [x] 2.3 RED/GREEN — `npx vitest run customers/queries` stays green,
  unmodified: the move did not change `buildClienteSearchWhere`'s rendered
  SQL or its existing test assertions.

- [x] 2.4 GREEN — comment on `vehiculoPlateExists`
  (`customers/vehicles.ts:95`) naming the two independent reasons the
  orders path does not call it: it correlates on the CUSTOMER, not the
  order's one named vehicle; and it applies `activeVehiculoFilter()`, which
  would hide an order whose vehicle was deactivated afterwards (D7). Amend
  the module header recording `vehiculo`'s second value-import site
  (amends vehicles-one-to-many D3's "imported here and nowhere else").

- [x] 2.5 RED (node) `service-orders/queries.test.ts` — extend
  `OrdenServicioFilters` to `{ status?, search? }`;
  `buildOrdenServicioWhere({ search: "perez" })` renders (via
  `PgDialect().sqlToQuery()`) an `or(...)` over `cliente.name`,
  `cliente.phone`, `vehiculo.plate` — three `unaccent(...) ilike unaccent(...)`
  terms — and the rendered text contains **neither** `deactivated_at is
  null` **nor** an `exists (select 1 from "vehiculo"` correlated subquery
  (D7's two things this path must NOT do). Confirm it fails: today's
  function takes only `status`.
- [x] 2.6 GREEN — implement the `search` branch in `buildOrdenServicioWhere`
  using plain column comparisons (`unaccentIlike(cliente.name, pattern)`,
  `unaccentIlike(cliente.phone, pattern)`, `unaccentIlike(vehiculo.plate,
  pattern)`), `and`-ed with the existing `status` condition when both are
  present, mirroring `buildClienteListWhere`'s `and(state, search)` shape.
  Import `unaccentIlike` from `@/shared/db/text-search`. Confirm
  `buildOrdenServicioWhere({})` still returns `undefined` — the existing
  `:19` test passes unmodified.
- [x] 2.7 **Mutation-verify 2.5 — the trap D7 exists to avoid.** Swap the
  plate term for `vehiculoPlateExists(pattern, unaccentIlike)` and add
  `isNull(cliente.deactivatedAt)` to the predicate (i.e., reuse
  `buildClienteSearchWhere`-style logic). Confirm 2.5's "no deactivated_at,
  no correlated subquery" assertions go red **by name**. `diff` to confirm
  the swap landed, then revert and `diff` again to confirm byte-identical.

- [x] 2.8 RED (node) — `listOrdenesServicio`'s default `queryFn`, inspected
  via its rendered SQL, contains `inner join "cliente"` and `inner join
  "vehiculo"` with `ON` predicates matching `ordenServicio.clienteId =
  cliente.id` and `ordenServicio.vehiculoId = vehiculo.id`. Confirm it
  fails against today's bare `db.select().from(ordenServicio)`.
- [x] 2.9 GREEN — add both `.innerJoin(...)` calls to `listOrdenesServicio`'s
  default `queryFn`; narrow the `.select({...})` to `OrdenServicioListItem`'s
  shape (a `Pick<OrdenServicio, "id" | "status" | "appointmentAt">` plus
  `clienteName`, `vehiculoPlate`, `vehiculoMake`, `vehiculoModel` — D9,
  mirroring `ClienteListItem`'s `.select({...})` shape at
  `customers/queries.ts:196-207`). Export the type. Update the one
  production caller (`service-orders/page.tsx`) and the existing test
  fixtures at `queries.test.ts:29,38,44` to the new shape — English keys in
  every fixture object, Spanish only inside quoted string values.
- [x] 2.10 RED (node) — `countOrdenesServicio`'s default `queryFn` ALSO
  carries both joins (D9's count-parity trap: "missed on the count, the
  list filters and the pager does not — page 2 of a search that has 4
  rows"). Confirm it fails: today's count has no join at all.
- [x] 2.11 GREEN — add the identical two `.innerJoin(...)` calls to
  `countOrdenesServicio`'s default `queryFn`, sharing
  `buildOrdenServicioWhere(filters)` with the list.
- [x] 2.12 **Mutation-verify D9's count-parity claim.** Remove the joins
  from `countOrdenesServicio` only, leaving `listOrdenesServicio`'s intact.
  Confirm 2.10 goes red **by name**. `diff` to confirm, revert, `diff`
  again.

- [x] 2.13 RED (node) — confirm `queries.test.ts:118`'s existing
  `expect(buildOrdenServicioOrderBy(undefined)).toHaveLength(1)` is now RED
  against the new no-sort branch. This is an already-committed guard —
  watch it fail before touching it, do not silently rewrite it.
- [x] 2.14 GREEN — the no-sort branch becomes
  `[sql`${ordenServicio.appointmentAt} desc nulls last`, desc(createdAt)]`
  (D10); update `:118`'s assertion to `toHaveLength(2)`; add a
  `PgDialect().sqlToQuery()` assertion that the PRIMARY expression's
  rendered SQL contains `desc nulls last` for the unsorted-default case
  specifically (distinct from the existing explicit-sort test at
  `:107-113`). `ORDEN_SORT` is untouched.
- [x] 2.15 **Mutation-verify D10.** Revert the no-sort branch to
  `[desc(createdAt)]` alone. Confirm 2.14's length/content assertions go
  red **by name**. `diff` to confirm, revert, `diff` again.
- [x] 2.16 RED/GREEN — `Object.keys(ORDEN_SORT).sort()` still equals
  `["appointmentAt", "id", "status"]` (existing `:92-94` test, confirm
  untouched — no new sortable column added).

- [x] 2.17 **Column-ambiguity check — the design's own unverified claim.**
  Read the actual rendered SQL from 2.8/2.9's query (`PgDialect().sqlToQuery()`
  or `.toSQL()`), with all three joined tables' `id` columns in scope, and
  confirm every identifier in the generated `SELECT`/`WHERE`/`ORDER BY` is
  table-qualified (`"cliente"."id"`, `"vehiculo"."id"`,
  `"orden_servicio"."id"`) rather than an ambiguous bare `"id"`.
  `vehicles.ts:61-77` documents Drizzle's qualifier elision dropping a
  table prefix in a DIFFERENT context (an interpolated raw `sql` field
  map) — record the ACTUAL output here, do not assume it does or doesn't
  apply to a typed `.select({...})` over a joined query.

- [x] 2.18 RED (jsdom) `service-orders/page.test.tsx` — the header row has
  no `Descripción`, has `Cliente` and `Vehículo`; a seeded row's `ID` cell
  reads exactly the first 8 characters of its id (`87cceecc` from an id
  starting `87cceecc-...`) in a `font-mono` class; for a vehicle with
  `plate = "AB1234"`, `make = "Toyota"`, `model = "Hilux"`, the `Vehículo`
  cell carries **both** the plate and the make/model (spec Scenario "List
  shows customer and the car, not just its plate" — the owner asked for "el
  auto con su placa" and selected a mockup reading `AB-1234 Hilux`; the
  plate alone does not identify which car is on the lift). Confirm it fails
  against today's `orden.description ?? "—"` column and full-UUID `ID` cell.
- [x] 2.19 GREEN — `COLUMNS` drops `Descripción`, adds `Cliente`/`Vehículo`;
  the `ID` `TableCell` renders `{orden.id.slice(0, 8)}` in
  `font-mono text-xs`; `Cliente` renders `orden.clienteName`; `Vehículo`
  renders `orden.vehiculoPlate` joined with `orden.vehiculoMake`/
  `orden.vehiculoModel` (e.g. `AB1234 Toyota Hilux`, mirroring the mockup's
  `AB-1234 Hilux` shape) — both fields are now consumed by the page, not
  merely carried on the type.
- [x] 2.20 RED (jsdom), same file — a vehicle with `make = NULL` and
  `model = NULL` (spec Scenario "A vehicle with no make or model still
  renders its plate") renders the `Vehículo` cell as the plate alone, with
  no trailing space, no dangling separator, and no empty segment. **A
  fixture with make/model both set cannot catch this** — the assertion must
  run against a vehicle shaped like the one the dev database already holds
  (both columns NULL, per `vehiculo.make`/`.model` being nullable `text`).
  Confirm it fails if 2.19's join naively concatenates `${plate} ${make}
  ${model}` without guarding the null case.
- [x] 2.21 GREEN — the `Vehículo` cell's render joins only the present
  parts (plate always; make/model appended only when at least one is
  non-null, with no leading/trailing whitespace or stray separator when
  both are absent).
- [x] 2.22 RED/GREEN — the detail page (`service-orders/[id]/page.tsx`)
  still renders the full UUID unchanged; confirm the existing detail-page
  test already covers this, add one assertion if it does not.

- [x] 2.23 RED (jsdom) `service-orders/page.test.tsx` — `search` survives a
  column-header sort click and a page-2 link (D11, the class of bug
  `customers/page.tsx:485-489` names by number). Confirm it fails: today's
  `normalizeOrdenFilters`, `buildSortHref`, `buildPageHrefPattern`,
  `buildFilterKey` know only `status`/`pageSize`.
- [x] 2.24 GREEN — `normalizeOrdenFilters` reads `search` via the file's
  existing `firstValue`; `buildSortHref`, `buildPageHrefPattern`,
  `buildFilterKey` each add a `search` line mirroring
  `customers/page.tsx`'s exact shape — `buildFilterKey` appends
  `` `|search=${filters.search ?? ""}` `` (search last, since it is free
  text and `status`/`search` must not be confusable, per
  `customers/page.tsx:392-397`'s rationale).
- [x] 2.25 GREEN — `ServiceOrderFilters` gains the search box: WU1's fourth
  `useUrlFilters`/`SearchFilterInput` call site (D1), wired to `search`,
  label "Filtro", placeholder "Buscar por nombre, placa o teléfono"
  mirroring `CustomerFilters`'s Spanish strings (service-orders spec: "the
  same three columns `buildClienteSearchWhere` already matches").

- [x] 2.26 `diff` every touched file (`text-search.ts`, `customers/queries.ts`,
  `customers/vehicles.ts`, `service-orders/queries.ts`,
  `service-orders/ServiceOrderFilters.tsx`, `service-orders/page.tsx`, and
  every touched test) before trusting 2.1–2.25.

- [x] 2.27 Provision a fresh throwaway Postgres database on
  `proyectocatalogo-db-1` (`:5433`) with `npx drizzle-kit migrate` on a
  **virgin** database — never `drizzle-kit push`, which poisons it
  (migration `0000` then collides with existing tables and `drizzle-kit
  migrate` exits 1 printing nothing, reading as a broken e2e). Migrations
  live in `src/shared/db/migrations`.
- [x] 2.28 Create `describe("order search (E2E)", ...)` in
  `src/e2e/full-flow.e2e.test.ts`, placed BEFORE
  `describe("full catalog-generation flow (E2E)", ...)` (today ~line 1414,
  whose `afterAll` ends the shared connection pool — anything appended after
  it never runs). Mirror `describe("single vehicle insert (E2E)", ...)`'s
  `beforeAll`/`afterAll` shape (`execSync("npx drizzle-kit migrate", { stdio:
  "inherit" })`, cascading delete in `afterAll`). Seed: one customer with
  TWO active vehicles (exercises "search the OTHER vehicle's plate"); order
  A created TODAY with `appointmentAt` NEXT WEEK; order B created LAST WEEK
  with `appointmentAt` YESTERDAY; order C with `appointmentAt = NULL`; one
  order whose vehicle is deactivated AFTER the order is created — every
  fixture row the design's exit criterion names explicitly.
- [x] 2.29 e2e (real Postgres, excluded from `npm test`) — assert: search
  "perez" (no accent) finds the order for "Pérez"; search by phone finds
  it; search by plate finds it; **searching the customer's OTHER vehicle's
  plate returns zero rows for the order that references the first
  vehicle**; **the order whose vehicle was deactivated afterwards is still
  found by that plate**; a word present only in `description` matches
  nothing; the unfiltered row count is unchanged from before the join; with
  no `sort` in the URL, the order reads A (appointment next week) → B
  (appointment yesterday) → C (no appointment) — sorted by `appointmentAt`,
  not by creation order, which is the opposite sequence.
- [x] 2.30 **Browser check, console open.** Open `/service-orders` with no
  filters: confirm headers read `ID · Cliente · Vehículo · Estado · Cita ·
  Acciones`, no `Descripción`; confirm the `ID` cell is 8 characters,
  monospace; confirm the `Vehículo` cell shows plate plus make/model for a
  vehicle that has them, and plate alone (no dangling separator) for one
  that does not. Type a customer name into the new search box, confirm the
  URL updates and results narrow. Open a result's detail page, confirm the
  full UUID. Click a column-header sort, then page 2 if present, confirm
  the search term survives both.
- [x] 2.31 `npm test` (alone) and `npx tsc --noEmit` clean.
- [x] 2.32 **Recorded, not smuggled.** `status` and `pageSize` read through
  `firstValue` in `buildSortHref` and `buildPageHrefPattern`, not only
  `search`. `normalizeOrdenFilters` already read `status` that way, so
  `?status=open&status=done` FILTERED by `open` while every sort and
  pagination link dropped status entirely. Fixing `search` alone — which is
  all 2.24 asked for — would have left two of three lying in the same file.
  Review called the first version a silent scope expansion, correctly: the
  justification was in a code comment and no test covered it. It has a task
  number and a test now (`keeps a duplicated status param in the sort and
  pagination links`, mutation-verified against the old `typeof` check).
- [x] 2.33 The empty state learned `search` too, and the copy stayed
  `"Ninguna orden coincide con el filtro."` — true for BOTH branches, and the
  one thing its own `Limpiar filtro` link agrees with. The first version
  narrowed it to `"la búsqueda"`, which made a status-only filter contradict
  its own call to action on screen. Both branches now tested.

### Phase 2 verification record — fill in during `sdd-apply`

| Task | Evidence |
|---|---|
| 2.2 | `text-search.test.ts`'s `wraps both the column and the pattern in unaccent(), joined by ilike` mutation-verified: swapped `ilike` → `like` in `text-search.ts`, test went red (`expected ... to contain 'ilike'`); `rg` confirmed the mutation landed; reverted, `rg` confirmed byte-identical, suite green (1/1). |
| 2.7 | Swapped the plate term for `vehiculoPlateExists(pattern, unaccentIlike)` and wrapped the `or(...)` in `and(isNull(cliente.deactivatedAt), ...)` in `queries.ts`. `diff` confirmed the mutation landed. Both named tests went red: `never carries a deactivated_at filter on either table — an order for a deactivated customer or vehicle is still a real order` and `never correlates through an EXISTS subquery — the vehicle is joined one-to-one on this list`. Reverted; `diff` confirmed byte-identical; suite green (28/28). |
| 2.12 | Removed both `.innerJoin(...)` calls from `ordenServicioCountQuery` only, leaving `ordenServicioListQuery` intact. `diff` confirmed the mutation landed. `countOrdenesServicio's query carries the identical two joins` went red by name (`select count(*) from "orden_servicio"` — no join). Reverted; `diff` confirmed byte-identical; suite green (31/31). |
| 2.15 | Reverted the no-sort branch to `[tiebreak]` alone. `diff` confirmed the mutation landed. Both `always appends a stable tiebreaker...` (length 2 expected, got 1) and `the unsorted default's primary expression is appointmentAt desc nulls last` (rendered `created_at desc`, no `appointmentAt`/`nulls last`) went red. Reverted; `diff` confirmed byte-identical; suite green (32/32). |
| 2.17 | Actual rendered `.toSQL()` output for `ordenServicioListQuery({search:"perez",status:"open"}, ..., {key:"id",dir:"asc"})`, captured and recorded verbatim in `queries.ts`'s doc comment: `select "orden_servicio"."id", ... from "orden_servicio" inner join "cliente" on "orden_servicio"."cliente_id" = "cliente"."id" inner join "vehiculo" on "orden_servicio"."vehiculo_id" = "vehiculo"."id" where (...) order by "orden_servicio"."id" asc nulls last, "orden_servicio"."created_at" desc limit $5`. Every identifier is table-qualified — Drizzle's `.select({...})` over typed Column objects does NOT hit the qualifier-elision trap `vehicles.ts:platesSubquery()` documents (that trap is specific to a raw `sql` fragment with hardcoded unqualified names). Regression test added asserting no bare `"id"`. |
| 2.20 | Mutated `vehiculoLabel` to naive `${plate} ${make} ${model}` concatenation. `diff` confirmed the mutation landed. `shows the plate alone, with no dangling separator, when make and model are both null` went red (`getByText("CD5678")` found no match — the naive version renders `"CD5678 null null"`). Reverted; `diff` confirmed byte-identical; suite green (19/19). |
| 2.27 | **Run by the orchestrator.** `dforce_wu2_search` on `:5433`, provisioned with `drizzle-kit migrate` on a freshly created database — never `push`, which poisons it for `migrate`. 13 tables. |
| 2.28 | e2e `describe("order search (E2E)", ...)` written in `src/e2e/full-flow.e2e.test.ts`, placed immediately before `describe("full catalog-generation flow (E2E)", ...)`. Not executed by this agent (no live DB access here). |
| 2.29 | **Run by the orchestrator: 57/57 against real Postgres**, the eight new `order search (E2E)` assertions included. This is WU2's exit criterion — a green unit suite proves zero coverage of the join or the search `WHERE`. |
| 2.30 | **Run by the orchestrator** against the owner's dev server with real data: truncated mono ID, `Cliente`, `Vehículo` as `AU5841 Honda CR-V`, no `Descripción`, newest appointment first. Search by plate/name/phone each returned rows, a nonsense term returned none, and clicking `Estado` with a search active kept it (`?search=sanchez&sort=status&dir=asc`). 0 console errors. |
| 2.31 | **Final gate run by the orchestrator**: `npm test` 1611/1611 · `npx tsc --noEmit` clean · `npm run lint` 0 errors / 14 warnings. The agent's own per-file runs are superseded by this. |

---


### WU2 verification record — what was actually run

A green `npm test` proves ZERO coverage of the join and the search `WHERE`
(AGENTS.md's injected-seam limit). This is the evidence.

| Check | Result |
|---|---|
| **e2e, real Postgres** — the exit criterion | **57/57** on a virgin throwaway DB provisioned with `drizzle-kit migrate` (never `push`, which poisons it) |
| The D7 trap | The e2e seeds a second vehicle for the same customer and asserts that searching ITS plate returns zero orders — the case `vehiculoPlateExists` would have got wrong |
| Browser, real data | ID truncated to 8 chars monospace; `Cliente`; `Vehículo` showing `AU5841 Honda CR-V` (plate AND make/model); no `Descripción`; newest appointment first |
| Search, all three fields | plate `AU5841` → 2 · name `sanchez` → 2 · phone `62944732` → 2 · nonsense → 0 |
| **D11 — the term survives a sort** | Clicking `Estado` with a search active gave `?search=sanchez&sort=status&dir=asc`. This is the bug class `customers/page.tsx` records twice; it does not happen here. |
| Console | 0 errors |

Gates: `npm test` 1611/1611 · `npx tsc --noEmit` clean · `npm run lint` 0
errors / 14 warnings (an unused `otherVehicleId` in the new e2e describe was
removed — the OTHER-vehicle case IS asserted, by plate rather than by captured
id, so the variable was genuinely spare and not a missing assertion).

The pre-existing committed RED behaved exactly as the design predicted:
`queries.test.ts`'s `toHaveLength(1)` failed the moment the appointment-first
default landed, and was updated rather than silently rewritten.

## Phase 3 — Vehicle catalog, and the escape that makes it safe
(vehicle-catalog spec: all seven requirements; customer-management delta: both
ADDED requirements; design D13–D20)

**Read D20 before reviewing this phase.** ~300 of WU3's ~500 lines are data
rows, and nobody reviewing can confirm from memory which models Chery sells in
Panama. What review is for here is the dataset's SHAPE (3.1–3.4), the ESCAPE
(3.7–3.10), the NEVER-BLANK rule (3.11–3.13), the RESET (3.14–3.16), and the
absence of any server or schema change (3.21). The rows themselves are the
owner's data, corrected by a one-line PR.

**The one thing that did not survive the handoff.** The make list was described
as 38 makes and enumerates 41 (counted: 10 Japanese, 3 Korean, 11 Chinese,
6 American, 9 European, 2 Indian). The enumeration is authoritative and no
artifact in this change writes a count — 3.1 asserts the SET. If 38 was the
intent, the owner names the three; an agent must not pick them.

- [x] 3.1 RED (node) — create `src/modules/customers/vehicle-catalog.test.ts`
  with D13's shape invariants, each `it` named after the invariant it pins so a
  failure says which one broke: the make SET equals the spec's enumerated list
  (`toEqual` on a sorted literal — a set, never a count, because a count rots
  away from the list it counts and already disagreed with it once); keys
  sorted; no duplicate key; every make has ≥1 model; every model non-empty and
  trimmed; no duplicate model within a make; no make named `"Otro"` and none
  equal to `OTHER`; and `VEHICLE_CATALOG.Toyota` contains `Hilux`, `Fortuner`,
  `Land Cruiser Prado` and `Rush`. Confirm every test fails: the module does
  not exist yet.
- [x] 3.2 GREEN — create `src/modules/customers/vehicle-catalog.ts`:
  `VEHICLE_CATALOG` as `Readonly<Record<string, readonly string[]>>` with the
  the spec's makes as SORTED keys, `VEHICLE_MAKES = Object.keys(...)`,
  `modelsForMake(make)` returning `[]` for an unknown make (never a throw — an
  unknown make is the normal state behind every free-text value, D13), and
  `export const OTHER = "__otro__"`. Put the origin grouping (Japanese /
  Korean / Chinese / American / European / Indian) in a comment block above the
  data, NOT in the structure — it is provenance, and the select never renders
  it. Model lists are Panama-market, authored per make; they are the part that
  can be wrong without breaking anything, which is what the escape is for.
- [x] 3.3 **Mutation-verify the shape test is not decorative.** Duplicate one
  model inside one make. Confirm 3.1's no-duplicate-model test goes red **by
  name**. `diff` to confirm the duplication landed, then revert and `diff`
  again, confirming byte-identical. (`sd` no-ops on multiline patterns and
  exits 0 on no match — edit the line directly, do not trust a regex.)
- [x] 3.4 **Mutation-verify the vPIC tripwire.** Remove `"Land Cruiser Prado"`
  from Toyota's models. Confirm 3.1's Toyota-anchors test goes red **by name** —
  this is the assertion that fires the day someone proposes regenerating the
  file from vPIC or `us-car-models-data`, both of which omit exactly those four
  models (design.md's WU3 preamble). `diff` both ways.

- [x] 3.5 RED (jsdom) — create
  `src/modules/customers/VehicleMakeModelFields.test.tsx`: the `Marca` select
  offers every catalog make plus `Otro`; with `make="Toyota"` the `Modelo`
  select offers Toyota's models plus `Otro` and does NOT offer a model from
  another make. Drive Base UI selects the way `UserForm.test.tsx:39-42`
  already does — click the label, then `await screen.findByRole("option", {
  name })` — not by typing into them. Confirm both fail: the component does not
  exist.
- [x] 3.6 GREEN — create
  `src/modules/customers/VehicleMakeModelFields.tsx` (`"use client"`) per the
  design's WU3 Interfaces block: `idPrefix`, `make`, `model`, `onChange`.
  Two `Select`s with the shipped shadcn wrapper, Spanish labels `Marca` and
  `Modelo`, placeholders `Seleccioná una marca` / `Seleccioná un modelo`
  (matching `UserForm`'s `Seleccioná un rol`), and `?? null` on the value so an
  empty field renders the placeholder rather than a blank option — the exact
  shape `UserForm.tsx:297` uses.

- [x] 3.7 RED (jsdom), same file — the escape, both directions: choosing
  `Otro` in `Marca` reveals a text input labelled `Especificá la marca`; typing
  in it emits that typed value through `onChange`; the literal string `"Otro"`
  is NEVER emitted as a make; and then choosing a catalog make in that same
  select hides the input and emits the catalog make. The last assertion is the
  no-dead-end rule (D14) — an escape you cannot climb back out of is a support
  ticket, and it is the half most likely to be skipped.
- [x] 3.8 GREEN — implement the `OTHER` sentinel: the select's value is
  `makeIsOther ? OTHER : (make || null)`, the revealed `Input` writes through
  `onChange`. Same treatment for `Modelo` under a catalog make, with
  `Especificá el modelo`.
- [x] 3.9 RED (jsdom), same file — with `Marca` in escape mode the `Modelo`
  field is a `textbox`, not a `combobox`: a select holding one option called
  "Otro" is a worse control than the text box it replaced (D14).
- [x] 3.10 GREEN — the model branch: no list ⇒ plain `Input`.

- [x] 3.11 RED (jsdom), same file — the never-blank rule, three cases (D15):
  mounting with `make="Hino"` (not in the catalog) renders the select reading
  `Otro` and a text input reading `Hino`; mounting with `make="Toyota"`,
  `model="Coaster"` renders the make as a SELECTED catalog value and the model
  as a text input reading `Coaster`; and mounting emits **no** `onChange` at
  all. That third assertion is what a create-path-only test never catches.
- [x] 3.12 GREEN — seed escape mode from the stored value with LAZY
  `useState(() => …)` initialisers, per D15's snippet. Lazy is load-bearing:
  a non-lazy initialiser re-runs every render and re-seeds off a rebuilt prop
  mid-typing, which is WU1's D3 lesson wearing different clothes.
- [x] 3.13 **Mutation-verify D15's seeding.** Replace both lazy initialisers
  with `useState(false)`. Confirm 3.11's unknown-stored-make test goes red **by
  name**. `diff` both ways. Without this, an unknown stored make silently
  renders as an empty select — the blanking the spec forbids, shipped green.

- [x] 3.14 RED (jsdom), same file — the reset (D16), and both halves of it:
  with `make="Toyota"`, `model="Hilux"`, changing the make to `Kia` emits
  `{ make: "Kia", model: "" }` in ONE `onChange` and the model select then
  lists Kia's models; changing the make while the model is a free-text value
  clears it too; and — the other half — mounting with a stored `make`/`model`
  leaves the model alone (this overlaps 3.11's third assertion deliberately,
  because 3.16 mutates against both).
- [x] 3.15 GREEN — clear the model IN THE MAKE CHANGE HANDLER: emit
  `{ make: next, model: "" }` and reset `modelIsOther` in the same handler.
  **No `useEffect` on `make`.** Typing inside the free-text make input does NOT
  clear the model — in escape mode the model is free text too, so there is no
  list for it to have fallen off, and a per-keystroke clear is hostile (D16).
- [x] 3.16 **Mutation-verify D16 — the primary mutation of this phase, and it
  is two mutations because the requirement has two halves that can each be
  satisfied by breaking the other.**
  (a) Drop `model: ""` from the make change handler. Confirm 3.14's
  "changing the make empties the model" test goes red **by name**.
  (b) Revert (a), then re-implement the reset as
  `useEffect(() => onChange({ make, model: "" }), [make])` — the obvious wrong
  fix D16 exists to forbid. Confirm 3.14's mount-preservation test (and
  3.11's "mounting emits no onChange") go red **by name**. If (b) leaves the
  suite green, the mount case is untested and the never-blank requirement is
  unpinned — fix the test before continuing.
  `diff` after each mutation and again after each revert, confirming
  byte-identical.

- [x] 3.17 RED/GREEN (jsdom) `VehicleQuickForm.test.tsx` — rewrite only how
  make and model are DRIVEN (select clicks instead of `type`). Every other
  assertion stays byte-identical, above all `"sends only plate, make, model and
  year"` and the `year`-is-a-`number` assertion: those are what say the consent
  trap stays unreachable (`VehicleQuickForm.tsx`'s header) and that
  `validation.ts:126`'s already-a-number rule is still satisfied.
- [x] 3.18 GREEN — in `VehicleQuickForm.tsx` replace the `Marca` and `Modelo`
  `Input`s with `<VehicleMakeModelFields idPrefix="vehiculo-rapido" … />`.
  Leave the `Placa` and `Año` inputs, the four-key body literal, the
  `Number(year)` coercion, `event.stopPropagation()`, the 400/404/409 branches
  and every `min-h-11 min-w-11` button untouched.
- [x] 3.19 RED/GREEN (jsdom) `CustomerForm.test.tsx` — same rewrite for the
  vehicle collection, plus the per-card independence assertion from the
  customer-management delta: selecting a make on the second card must leave the
  first and third cards' make and model unchanged. Existing plate/year,
  soft-delete, permanent-delete and reconcile assertions stay unmodified.
- [x] 3.20 GREEN — in `CustomerForm.tsx`'s vehicle card replace the `Marca` and
  `Modelo` `Input`s with `<VehicleMakeModelFields idPrefix={row.key} make={row.make}
  model={row.model} onChange={(next) => updateVehicle(row.key, next)} />`.
  `buildPayload`, `activeVehicles`, the deletion flow and `row.key`'s
  `crypto.randomUUID()` regeneration all stay as they are — D15 relies on that
  regeneration remounting the fields after a save, so `rg "crypto.randomUUID"
  src/modules/customers/CustomerForm.tsx` must still return the emptyVehicle
  factory.

- [x] 3.21 **Prove the "no server change" claim rather than asserting it**
  (D18): `git diff --name-only` for this unit must list no file under
  `src/app/api/`, not `src/modules/customers/validation.ts`, not
  `src/shared/db/schema.ts`, and no file under the migrations directory. Then
  `rg "Number\(year\)" src/modules/customers` and `rg "typeof value.year ===
  \"number\"" src/modules/customers/validation.ts` — both must still hit,
  confirming the `year` coercion on both ends survived a refactor of the field
  block next to it.
- [x] 3.22 Confirm D19's height ruling landed as written: the two
  `SelectTrigger`s carry NO `min-h-11` (they are form fields matching their
  `h-8` sibling `Input`s, precedent `UserForm.tsx:299`), and every action
  control around them still does — `rg "min-h-11" src/modules/customers/VehicleQuickForm.tsx`
  must still return the dialog trigger, `Cancelar` and `Guardar vehículo`.
  **No test in this repo can measure a rendered height**, so this grep plus the
  browser check at 3.25 is the entire enforcement.
- [x] 3.23 Language-split check before the PR: every Spanish string in the two
  new test files is an ASSERTION or a label being queried; every object key,
  helper name, `it()` name and variable in those helpers is ENGLISH. Caught
  twice in review on the previous change, both times as a Spanish object key in
  a test helper.
- [x] 3.24 `diff` `vehicle-catalog.ts`, `VehicleMakeModelFields.tsx`,
  `VehicleQuickForm.tsx` and `CustomerForm.tsx` before trusting 3.1–3.23.
- [x] 3.25 **Browser check, console open.** Open the customer form with a
  customer holding at least two vehicles, and the order dialog's quick form.
  Read: the two selects beside `Placa`/`Año` at a narrow width; the revealed
  `Especificá la marca` input's reflow inside the `sm:grid-cols-2` grid; a
  full make list opened on a touch-sized target; zero console warnings.
  jsdom sees none of this — it measures no height, reports no hydration
  mismatch, and would not flag an RSC boundary if one appeared. Record the
  result in the PR body.
- [x] 3.26 `npm test` (alone — this machine produces phantom timeouts when
  suites overlap) and `npx tsc --noEmit` clean.

### Phase 3 verification record — fill in during `sdd-apply`

| Task | Evidence |
|---|---|
| 3.3 | Duplicated `"Civic"` inside Honda's model list in `vehicle-catalog.ts`. `diff` confirmed the mutation landed. `no duplicate model within a make` went RED by name (`expected 6 to be 7`). Reverted; `diff` confirmed byte-identical; suite green (10/10). |
| 3.4 | Removed `"Land Cruiser Prado"` from Toyota's models. `diff` confirmed the mutation landed. `Toyota carries the four models vPIC omits (Hilux, Fortuner, Land Cruiser Prado, Rush)` went RED by name. Reverted; `diff` confirmed byte-identical; suite green (10/10). |
| 3.13 | Replaced both lazy `useState(() => …)` initialisers in `VehicleMakeModelFields.tsx` with `useState(false)`. `diff` confirmed the mutation landed. Both named tests went red: `an unknown stored make mounts in escape mode showing that value` and `a catalog make with an unknown stored model mounts with the make selected and the model as text`. Reverted; `diff` confirmed byte-identical; suite green (11/11). |
| 3.16a | Dropped `model: ""` from `handleMakeSelect` (kept `model` unchanged). `diff` confirmed the mutation landed. `changing the make empties the model and re-lists the new make's models` went RED by name. Reverted; `diff` confirmed byte-identical. |
| 3.16b | Re-implemented the reset as `useEffect(() => onChange({ make, model: "" }), [make])` (the forbidden pattern), on top of (a)'s revert. `diff` confirmed the mutation landed. Both `mounting emits no onChange at all — the case a create-path-only test never catches` (3.11) and `changing the make empties the model and re-lists the new make's models` (3.14) went RED by name — (b) did NOT leave the suite green, so no test needed strengthening. Reverted; `diff` confirmed byte-identical; suite green (11/11). |
| 3.21 | `git status --porcelain` lists only `CustomerForm.tsx`, `CustomerForm.test.tsx`, `VehicleQuickForm.tsx`, `VehicleQuickForm.test.tsx` (modified) plus `vehicle-catalog.ts`, `vehicle-catalog.test.ts`, `VehicleMakeModelFields.tsx`, `VehicleMakeModelFields.test.tsx` (new) — no file under `src/app/api/`, no `validation.ts`, no `schema.ts`, no migrations. `rg "Number\(year\)" src/modules/customers` and `rg "Number\(v.year\)"` both still hit (`VehicleQuickForm.tsx:101`, `CustomerForm.tsx:145`); `rg 'typeof value.year === "number"' src/modules/customers/validation.ts` still hits (`validation.ts:126`). |
| 3.25 | **Run by the orchestrator** — see the WU3 verification record below: 42 make options with `Otro` last, Toyota listing Hilux/Fortuner/Land Cruiser Prado/Rush, zero app errors. The implementing agent could not: jsdom sees no height, reflow or hydration mismatch, and it has no browser. |
| 3.26 | `npm test` (alone): **1639/1639 passed**, 111 files. `npx tsc --noEmit`: clean. `npm run lint`: 0 errors / 14 warnings, matching the documented baseline exactly — no new warning introduced. **Closed by the orchestrator after two GGA rounds**: 1640/1640, `tsc` clean, lint 0 errors / 14 warnings. |

---


### WU3 verification record

Browser check run by the orchestrator against the owner's dev server, from the
order dialog for a customer with no vehicles:

| Check | Result |
|---|---|
| Marca is a select | **42 options — every approved make plus `Otro` last.** Lexus, Changan and Tata present; sorted (`Audi`, `BAIC`, `BMW`, `BYD`, `Changan`…). |
| The anchors | Choosing Toyota lists **Hilux, Fortuner, Land Cruiser, Land Cruiser Prado, Rush** alongside Corolla/Yaris/Camry/RAV4. Those four are the ones vPIC omits, which is the whole reason this catalog is curated in-repo. |
| Modelo is a select and depends on the make | Empty until a make is chosen; Toyota's list appears on selection. |
| Console | Zero app errors. The 102 entries present are one identical burst of a Chrome-extension messaging error from an old print-page load, not this feature. |

Dataset verified independently of the implementing agent: every approved make
present, none missing, and **no count written anywhere in code or tests** — the
shape test asserts the SET, so a make added later cannot fail on arithmetic.
`git diff --name-only` proves D18's no-server-change claim: nothing under
`api/`, `schema.ts`, `migrations/` or `validation.ts`.

The make→model reset was re-mutated independently: dropping `model: ""` from
the change handler turns *changing the make empties the model and re-lists the
new make's models* red by name.

Gates: `npm test` 1639/1639 · `npx tsc --noEmit` clean · `npm run lint` 0
errors / 14 warnings.

**GGA found a placebo, and it MEASURED it rather than arguing.** The commit
said "both halves are mutation-verified"; one half was not. `changing the make
also clears a free-text model` rendered the component directly with a fixed
`model=""` prop — and the component is CONTROLLED, so typing into the escape
input never advanced it. The assertion was satisfied by the initial value, not
by the reset, and the D16 mutation left it green while its sibling went red.
The spec scenario *"switching make drops a free-text model too"* had no
coverage at all. Driven through the `Harness` now; both go red together.

**And the branch keyed off the wrong question.** `makeIsOther` asks "is the
make free text"; what matters is "is there a list to choose from". With no make
chosen — the DEFAULT state of every new vehicle row on both write paths —
`models` is empty and `Modelo` rendered a combobox whose only option was
`Otro`, which is exactly the control D14 calls worse than the text box it
replaces. `models.length === 0` subsumes both cases. It had no test either; it
does now, mutation-verified against the old condition.

Three smaller ones: a `className` prop neither caller passed, an assertion that
could not fail (`not.toBe("Otro")` against a `"__otro__"` sentinel), and a
verification cell reading "left unticked" beside a ticked box.

**GGA round 2 found the one defect an operator could actually reach.**
`modelsForMake` did `VEHICLE_CATALOG[make] ?? []` over a plain object literal,
so the PROTOTYPE CHAIN answered: `modelsForMake("constructor")` returned the
`Object` constructor — a function whose `.length` is 1, which sailed past the
caller's `models.length === 0` check and reached `.map` on a function.
Reproduced three ways in jsdom: mounting with `make="constructor"`, mounting
`make="valueOf"` with a stored model, and simply TYPING `constructor` into
"Especificá la marca".

The third is why it is a defect and not a curiosity: free text is a
REQUIREMENT of this capability, so arbitrary staff input is that field's
designed contract, and a subset of it took the form down on both write paths.
`Object.hasOwn` closes it — the same trap `service-orders/categories.ts`
already records, where `"toString" in CATEGORIA_LABEL` is true.

The test that should have caught it was named *"returns an empty array, never a
throw"* and probed one ordinary string. A name claiming more than its body
checks is what let this through; it now walks the inherited keys and goes red
against the old lookup.

**Disclosed by the implementing agent rather than claimed:** tasks 3.6–3.10
were built in one coherent GREEN pass instead of the literal step-by-step
RED/GREEN, with AGENTS.md's retrofit carve-out applied — break the built logic,
confirm red by name, revert with a `diff`. Same evidentiary weight, stated
plainly.

## Phase 4 — `service_due` restricted to preventive and corrective categories
(service-orders spec: *Service Due Reminder Restricted to Preventive and
Corrective Categories*; design D12)

- [x] 4.1 RED (node) `reminders/schedule.test.ts` — extend `makeOrden` to
  accept a `categoria` override (the schema field, `orden_servicio.categoria`,
  `.notNull()`), defaulting to `"mant_preventivo"` so every existing test
  keeps its current behavior unless it opts into a different category.
  Add `describe.each` driven off `CATEGORIA_LABEL`'s own keys (a test-only
  import from `service-orders/categories.ts`, no production edge — D12)
  asserting the expected `service_due` outcome per category:
  `mant_preventivo`/`mant_correctivo` → scheduled (both channels, as today);
  `instalacion`/`reparacion`/`revisado` → none. Confirm it fails: today's
  `planReminders` schedules `service_due` for all five categories
  unconditionally.
- [x] 4.2 GREEN — in `schedule.ts`, add
  `const SERVICE_DUE_CATEGORIES: readonly OrdenServicio["categoria"][] =
  ["mant_preventivo", "mant_correctivo"]`, typed off the schema enum with no
  new import direction (`schedule.ts` already imports `type { OrdenServicio
  }`; `service-orders/categories.ts` is NOT imported here — D12's direction
  rule, service-orders depends on reminders, never the reverse). Gate the
  existing `if (order.completedAt)` branch in `planReminders` on
  `SERVICE_DUE_CATEGORIES.includes(order.categoria)` as well.
- [x] 4.3 RED/GREEN — confirm the `appointment` reminder path is untouched
  for all five categories: `schedule.test.ts`'s existing appointment tests
  keep passing unmodified (the gate only touches the `completedAt`/
  `service_due` branch).
- [x] 4.4 **Mutation-verify — the exact mutation named in the prompt.** Add
  `"revisado"` to `SERVICE_DUE_CATEGORIES`. Confirm 4.1's `revisado` case
  goes red **by name**. `diff` to confirm the addition landed, then revert
  and `diff` again to confirm byte-identical.
- [x] 4.5 Make the sixth-category guard REAL, not described. `describe.each`
  over `CATEGORIA_LABEL`'s keys cannot fail by omission: it generates a case
  for a new key, the scheduled set does not contain it, the title becomes
  "schedules NO service_due", and it passes — defaulting a new category to
  not-reminding, which is this same defect with the sign flipped. GGA caught
  the first version of this task asserting the opposite, by adding a sixth
  category and watching the suite stay green. The guard is therefore an
  explicit exhaustiveness assertion pinning `Object.keys(CATEGORIA_LABEL)`
  against a written list, which a new key fails until somebody edits it —
  which is the moment the decision gets made. Verified by adding `pintura` and
  confirming it goes red by name.
- [x] 4.6 `diff` `schedule.ts` and `schedule.test.ts` before trusting
  4.1–4.5.
- [x] 4.7 `npm test` (alone) and `npx tsc --noEmit` clean.

### Phase 4 verification record — fill in during `sdd-apply`

| Task | Evidence |
|---|---|
| 4.4 | — |
| 4.7 | — |

---

### WU4 verification record

The 90 days already existed (`SERVICE_DUE_AFTER_DAYS = 90`); the CONDITION did
not, so `service_due` fired for all five categories. There is no `reminders`
capability in `openspec/specs/` and `service_due` appears in no consolidated
spec — the rule had never been written down anywhere but the code, which is
exactly why nobody noticed it applied to everything.

The category table is driven off `CATEGORIA_LABEL`'s own keys AND the key set
is pinned. **GGA caught the first version of this claim as false, by checking
it**: `describe.each` alone generates a case for a new key, the scheduled set
does not contain it, and it passes as "no reminder" — defaulting a new category
to not-reminding, which is this defect with the sign flipped. The exhaustiveness
assertion is what makes it true, verified by adding a sixth category and
watching it go red.

Two mutations, both red by name: adding `"revisado"` to
`SERVICE_DUE_CATEGORIES` breaks its `schedules NO service_due` case, and
removing the gate entirely breaks `transitionOrder -> done schedules NOTHING
for a category the rule excludes` — the second being the one that proves the
gate REACHES the wiring, since `transitionOrder` still calls
`planAndScheduleReminders` unconditionally.

**One test shipped as a placebo before that second mutation caught it.** The
sibling was generated with its assertion accidentally stripped, so it asserted
nothing and passed under mutation. Repaired, not deleted — the case is real,
the assertion was missing. It is the same defect this record keeps naming in
other people's work.

An existing test also went red for the right reason: `service.test.ts`'s
`transitionOrder -> done` fixture omitted `categoria` — a `.notNull()` column —
and the cast hid it. AGENTS.md's "a mock more convenient than reality tests the
mock". Spelled out now.

**This REMOVES a reminder** that `instalacion`, `reparacion` and `revisado`
currently get. `revisado` is Panama's mandatory ANNUAL ATTT inspection, so 90
days was always the wrong interval for it; 365 is its own change, not this gate
loosened.

Gates: `npm test` 1590/1590 · `npx tsc --noEmit` clean · lint 0 errors / 14
warnings.

## Follow-ups — named, deliberately not folded into this change


- **Three ~50-line copies of the `next/navigation` mock** now live in
  `useUrlFilters.test.tsx`, `InventoryFilters.test.tsx` and
  `ServiceOrderFilters.test.tsx`. GGA named the irony: this landed in a unit
  whose whole argument is that three copies of one file hid two defects. It is
  a test fixture rather than production behaviour, so it is deliberately not
  folded in here — but it is the same shape, and the next copy is WU2's.
- **`revisado`'s own 365-day reminder.** Restricting `service_due` to two
  categories is a removal for `revisado`; its own annual reminder is a
  separate change (proposal Out of Scope).
- **Sorting `/service-orders` by customer or plate.** Needs a joined
  `ORDER BY` with `unaccent`/`lower` wrapping like `CLIENTE_SORT` — new SQL
  this change does not add. `ORDEN_SORT` stays `id`/`status`/`appointmentAt`.
- **`/inventory`'s search does not accent-fold.** `inventory-view/queries.ts`
  uses bare `ilike`. Now that `unaccentIlike` has a neutral home
  (`src/shared/db/text-search.ts`, WU2/D8), this is a two-line change,
  deliberately not bundled here.
- **Unbounded `text` on `plate`/`make`/`model`** on both vehicle write
  paths — an already-recorded follow-up this change makes smaller, not
  unnecessary.
- **Backfilling the 3 existing vehicles** to catalog values, once WU3 ships.
- **Any network vehicle source, cache table, or sync job** — rejected in
  design.md's Approach; a curated local file is correctable in a one-line
  PR instead.
- **Searching order `description`.** Excluded for the same reason it is
  excluded from `ORDEN_SORT` — unindexed free text with no user-meaningful
  match.

## Closing checklist (maps to proposal.md's Success Criteria)

- [ ] Typing in the `/customers`, `/inventory`, and `/service-orders` search
      boxes produces zero console warnings, verified in a browser — WU1
- [ ] Clearing filters empties the box without touching a DOM node by hand —
      WU1
- [ ] `/service-orders` finds an order by customer name, by phone, and by
      plate, proven against real Postgres, with the unfiltered row count
      unchanged — WU2 (e2e, exit criterion)
- [ ] The list shows customer and the car (plate plus make/model, degrading
      to the plate alone when make/model are absent), a truncated
      8-character ID, and no `Descripción`; the detail page still shows the
      full UUID — WU2
- [ ] With no `sort` in the URL, orders read newest-appointment-first and
      orders without an appointment sit last, proven on data where
      `appointmentAt` and `createdAt` disagree — WU2 (e2e)
- [ ] Completing a `mant_preventivo` or `mant_correctivo` order schedules
      `service_due`; the other three schedule none — WU4
- [ ] `npm test` and `npx tsc --noEmit` clean at the end of every unit — all
      three built units
- [ ] Every unit was opened in a browser with the console read
- [ ] A vehicle not in the catalog is still recordable via "Otro", and
      choosing "Otro" by mistake is reversible without a reload — WU3
- [ ] Both vehicle write paths offer the same makes and models, structurally
      (one shared control, one catalog module) rather than by convention — WU3
- [ ] A stored make or model outside the catalog opens, survives an unrelated
      edit, and saves back unchanged — WU3
