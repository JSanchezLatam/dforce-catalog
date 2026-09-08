# Apply Progress: table-column-sorting

## Work Unit 1 — `/customers` (branch `feat/table-sorting-wu1-customers`)

Status: **9/10 tasks done, 1 blocked (browser check, no tool access) — do not
mark task 1.9 `[x]` until a human or browser-capable agent completes it.**

### Task 1.1 — `lc_collate` measurement

Throwaway DB `dforce_sort_test`, native Postgres 17 (Homebrew), migrated via
`npm run db:migrate`.

```
psql -d dforce_sort_test -c "SHOW lc_collate;"
-- ERROR: unrecognized configuration parameter "lc_collate"
psql -d dforce_sort_test -c "SELECT datcollate FROM pg_database WHERE datname = current_database();"
--  datcollate
-- -------------
--  en_US.UTF-8
```

`SHOW lc_collate` is not a recognized GUC on this Homebrew Postgres 17 build
(other `SHOW` commands, e.g. `server_encoding`, `server_version`, worked
fine — ruled out a broader proxy/connection issue). `pg_database.datcollate`
is the task's own documented fallback query and gave the authoritative
answer: **`en_US.UTF-8`, not `C`**. No `unaccent()` fix carried into task 1.6.

### Task 1.2 — `plates` orderability spike

Seeded on the same throwaway DB:

```sql
INSERT INTO cliente (id, name, phone, email, created_at) VALUES
  ('c1','Carlos','11111111','c1@x.com',now()),
  ('c2','Beatriz','22222222','c2@x.com',now()),
  ('c3','Ana','33333333','c3@x.com',now()),
  ('c4','Diego','44444444','c4@x.com',now());
INSERT INTO vehiculo (id, cliente_id, plate, created_at) VALUES
  ('v1','c1','ZZZ111',now()), ('v2','c2','BBB222',now()),
  ('v2b','c2','CCC999',now()), ('v3','c3','AAA333',now());
```

Ran the exact `platesSubquery()` SQL fragment (`vehicles.ts:78-81`) in
`ORDER BY ... ASC` and `DESC`:

```
ASC:  c3 Ana {AAA333} → c2 Beatriz {BBB222,CCC999} → c1 Carlos {ZZZ111} → c4 Diego {}
DESC: c1 Carlos {ZZZ111} → c2 Beatriz {BBB222,CCC999} → c3 Ana {AAA333} → c4 Diego {}
```

Both conditions hold: **it executes**, and the array-lexicographic order
**reads sensibly** (alphabetical by first plate; the zero-vehicle customer's
`{}` sorts last in both directions, which is the expected edge case, not a
defect). `plates` is therefore in `CLIENTE_SORT`, and the Vehículos header
is sortable — see the task 1.6 deviation note below for why this departs
from tasks.md's literal wording.

### Task 1.3/1.4 — RED/GREEN `parseClienteSort` + `CLIENTE_SORT`

RED (function did not exist yet):

```
FAIL src/modules/customers/queries.test.ts > parseClienteSort > returns a defined sort for the whitelisted column name
TypeError: parseClienteSort is not a function
... (8 failures total: 4× "returns a defined sort" for name/phone/email/plates,
    "column not on whitelist", "dir outside asc|desc", "no sort param" ×2 shapes,
    "CLIENTE_SORT whitelists exactly...")
Test Files  1 failed (1)
     Tests  8 failed | 19 passed (27)
```

GREEN after implementing `CLIENTE_SORT`, `parseClienteSort`,
`buildClienteOrderBy`, and the `sort` param on `listClientes` (positional
before `queryFn`) in `src/modules/customers/queries.ts`:

```
Test Files  1 passed (1)
     Tests  27 passed (27)
```

The pre-existing `listClientes` test at (old) line 157 passed its fake
`queryFn` as the 3rd positional argument; updated to the 4th
(`listClientes({...}, {...}, undefined, async () => rows)`) to match the new
signature — this is a mechanical fix to an existing call site, not new scope.

`api/customers/route.ts` was **not edited**: it calls `list(filters,
pageWindow)` with 2 args, so `sort`/`queryFn` both default to `undefined` and
the real branch's `.orderBy()` falls back to `desc(cliente.createdAt)` —
byte-identical to before.

### Task 1.5/1.6 — RED/GREEN page headers

RED (headers were still plain `<th>` text):

```
FAIL CustomersPage — column sorting > renders name/phone/email/plates headers as links...
FAIL CustomersPage — column sorting > toggles the active column to desc, preserves search/status/pageSize, and drops page
FAIL CustomersPage — column sorting > marks only the active header with aria-sort, matching the URL direction
FAIL CustomersPage — column sorting > falls back to default order without throwing on a hand-typed garbage sort/dir
Tests  4 failed | 19 skipped (23)
```

GREEN after adding `SortableHeader`, `buildSortHref`, and wiring
`parseClienteSort`/`sort` into the `listClientes` call in
`src/app/(app)/customers/page.tsx`:

```
Test Files  1 passed (1)
     Tests  23 passed (23)
```

The mock at the top of `page.test.tsx` (`vi.mock("@/modules/customers/queries", ...)`)
had to switch from a hand-listed `{ listClientes, countClientes }` object to
`importOriginal()` + spread, so the real (pure) `CLIENTE_SORT`/`parseClienteSort`
run in the test rather than a hand-copied whitelist drifting from the real one
— the exact "mock more convenient than reality" failure mode AGENTS.md warns
about.

**Deviation from tasks.md 1.6's literal wording, argued with evidence**: the
parenthetical "(`name`, `phone`, `email` only — `plates` conditional on 1.2,
`Vehículos`/`Acciones` never)" reads as internally contradictory. The spec's
own "Conditional Vehicles Column for Customers" requirement is unambiguous:
"[the Vehículos header] MUST NOT render a clickable header UNLESS
implementation-time verification proved both conditions" — a negative that
only binds pending proof, not a fixed exclusion. Task 1.2 proved both
conditions. Implemented Vehículos/`plates` as the 4th sortable column,
consistent with design D2 ("One object [`CLIENTE_SORT`] means query and page
cannot disagree") — the page iterates `Object.keys(CLIENTE_SORT)` rather than
hardcoding three column names, so the two can never drift apart again.

AGENTS.md's 44×44 hit-target rule applies: the header `<Link>` carries
`min-h-11 min-w-11` (same class of action control as the row's `Ver` link a
few lines below, which already carries the same classes).

### Task 1.7 — real-SQL smoke check (no injected `queryFn`)

Ran via a throwaway `tsx` script (not committed) calling the real,
production `listClientes` against `dforce_sort_test` with no `queryFn`
override — the one branch the injected-seam unit tests never execute:

```
--- name asc ---   c3 Ana, c2 Beatriz, c1 Carlos, c4 Diego
--- name desc ---  c4 Diego, c1 Carlos, c2 Beatriz, c3 Ana
--- phone asc ---  c1(111...) c2(222...) c3(333...) c4(444...)
--- phone desc --- c4 c3 c2 c1
--- email asc ---  c1 c2 c3 c4   (c1@ < c2@ < c3@ < c4@)
--- email desc --- c4 c3 c2 c1
--- plates asc --- c4{} c3{AAA333} c2{BBB222,CCC999} c1{ZZZ111}
--- plates desc -- c1{ZZZ111} c2{BBB222,CCC999} c3{AAA333} c4{}
```

All four whitelisted columns, both directions: PASS. Generated SQL executed
against a real Postgres connection and returned the expected order.

### Task 1.8 — mutation-verify

**`parseClienteSort`** — replaced the body with `return undefined;`:

```diff
-export function parseClienteSort(searchParams: RawSearchParams): ClienteSort | undefined {
-  const key = firstSortValue(searchParams.sort);
-  const dir = firstSortValue(searchParams.dir);
-  if (!key || !(key in CLIENTE_SORT)) return undefined;
-  if (dir !== "asc" && dir !== "desc") return undefined;
-  return { key: key as keyof typeof CLIENTE_SORT, dir };
-}
+export function parseClienteSort(_searchParams: RawSearchParams): ClienteSort | undefined {
+  return undefined; // MUTATION-VERIFY — must revert
+}
```

Reddened exactly the intended tests (the whitelist/garbage/no-param cases
still passed since `undefined` matches them by coincidence — expected, not a
gap, since those assert `toBeUndefined()`):

```
FAIL parseClienteSort > returns a defined sort for the whitelisted column email
FAIL parseClienteSort > returns a defined sort for the whitelisted column plates
(4/8 failed, 4/8 passed by coincidence)
```

Restored via `cp` from a pre-mutation backup; `diff` against the backup was
empty (byte-identical); re-ran — 27/27 green.

**`buildSortHref`** — replaced the body with a fixed `"/customers"`:

```diff
-function buildSortHref(params: SearchParams, key: keyof typeof CLIENTE_SORT, currentSort: ClienteSort | undefined): string {
-  const search = new URLSearchParams();
-  ...
-  return `/customers?${search.toString()}`;
-}
+function buildSortHref(_params: SearchParams, _key: keyof typeof CLIENTE_SORT, _currentSort: ClienteSort | undefined): string {
+  return "/customers"; // MUTATION-VERIFY — must revert
+}
```

Reddened exactly the two href-asserting tests:

```
FAIL CustomersPage — column sorting > renders name/phone/email/plates headers as links carrying ?sort=&dir=asc by default
FAIL CustomersPage — column sorting > toggles the active column to desc, preserves search/status/pageSize, and drops page
Tests  2 failed | 2 passed | 19 skipped (23)
```

Restored via `cp` from a pre-mutation backup; `diff` empty; re-ran — 23/23
green.

### Task 1.9 — browser check: **BLOCKED, not done**

This sdd-apply session has no browser-automation tool (no Playwright/devtools
MCP surfaced to this agent) and no dev-session credentials. Confirmed the dev
server is up and the route does not 500:

```
curl -sD - -o /dev/null http://localhost:3000/customers
HTTP/1.1 307 Temporary Redirect
location: /login
```

That is server-liveness evidence only — it is NOT the console-error/hydration
check AGENTS.md requires for a change crossing a Server Component boundary.
Reporting this honestly per the "never write a claim you have not checked"
rule rather than fabricating a browser check. **A human or browser-capable
agent must open `/customers`, apply a sort (both light and dark themes),
and confirm zero console errors before task 1.9 is marked `[x]`.**

### Task 1.10 — full gates

- `npm test`: **1303/1303 passed** (91 → still 91 test files; +12 tests over
  the pre-WU1 baseline of 1291: 8 in `parseClienteSort`, 4 in the page's
  `column sorting` describe).
- `npx tsc --noEmit`: clean, no output.
- `npm run lint`: **0 errors, 15 warnings** — unchanged from the documented
  baseline (2026-08-28).

### Files touched (matches the scope fence exactly)

- `src/modules/customers/queries.ts`
- `src/modules/customers/queries.test.ts`
- `src/app/(app)/customers/page.tsx`
- `src/app/(app)/customers/page.test.tsx`

`src/app/api/customers/route.ts` was **not touched** (confirmed via
`git diff --name-only`).

### Cleanup

Dropped `dforce_sort_test` and removed the throwaway `tsx` smoke-check
script after task 1.7 — nothing left behind on the native Postgres instance.

### Not committed

Per instructions, no commit was made this session. `git diff --name-only`
shows exactly the four in-scope files.
