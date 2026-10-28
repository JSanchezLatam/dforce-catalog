# Verification Report: sidebar-redesign

**Verdict: PASS WITH WARNINGS** (0 critical, 6 warnings, 3 suggestions), 2026-10-28, on `feat/sidebar-wu4b-slash-rail` (tip of the chain).

Every spec scenario has code behind it, and every unit-tagged scenario has a passing test. The warnings were test-coverage gaps, not broken behavior; W1, W5 and W6 were closed before merge (see Resolution).

## Evidence

| Command | Result |
|---|---|
| `npx vitest run` (sidebar, app-sidebar, `src/modules/layout`) | 8 files, 145/145 passed |
| `npx vitest run --maxWorkers=2` (full suite) | 284 files, 4412/4412 passed |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | 0 errors, 13 warnings (baseline) |
| LAN browser run (tasks 5.1–5.5) | recorded in `tasks.md`; zero hydration/serialization errors |

## Requirement → code → test

Test files: `S` = `src/components/ui/sidebar.test.tsx`, `A` = `src/components/app-sidebar.test.tsx`, `N` = `src/modules/layout/NavSearch.test.tsx`, `F` = `src/modules/layout/nav-search.test.ts`.

| Requirement | Code | Covering tests | Status |
|---|---|---|---|
| Floating panel shell | `sidebar.tsx` inset classes; `app-sidebar.tsx` `variant="inset"`; `layout.tsx` | S inner panel radius/border/shadow; S content panel 16px | W1 (closed) |
| Active item | `activeChildHref`, `activeByParent`, `NavLinkItem` | A expanded `/tablero/clientes`; A top-level `aria-current`; A rail Tablero active; A search does not move the mark | W2 |
| Group labels | chevron, muted labels, no separators | A chevron reveal; A closed chevron visible; A labels muted; A no separator | Covered |
| Icon rail preserved | `NavLinkItem`, rail search button | A rail dot + tooltip count; N rail button | W4 |
| User card | border, menu order, side | A border; A menu order | W3 |
| Sheet close button | `sidebar.tsx` `SheetClose` | S 44x44 + no English close; S closes; S Spanish dialog name | Covered |
| Search filter | `filterNavGroups`, `highlight` | F child/parent matches; F técnico "usuarios" → []; A highlight; A "Sin resultados"; A cookie untouched | W5 (closed) |
| Search keyboard | `NavSearch` | N `/` focus, editable targets, modifiers, rail, closed sheet, Esc, Enter, chip | W6 (closed) |
| Insecure context, hydration | no secure-context API; CSS-only coarse differences | LAN run only | Evidence |

## Warnings

- **W1** — no test asserted that `AppSidebar` passes `variant="inset"`. *Closed before merge.*
- **W2** — the rail dropdown marks the current child with `font-semibold` only, no `aria-current`; `/kanban` dropdown marking is covered via `/tablero*` paths. Follow-up.
- **W3** — user menu placement (above / right in the rail) is untested; above recorded in 5.1.
- **W4** — rail tooltip tested with count 5, spec says 6; same formatting path.
- **W5** — forced-open while searching was untested for a saved-closed *parent*. *Closed before merge.*
- **W6** — the `AppSidebar` → `NavSearch` Enter wiring was tested in halves only. *Closed before merge.*

## Design deviations

Recorded in `design.md` ("Deviations recorded at verify"); none breaks the spec.

## Resolution

W1, W5 and W6 each got one `AppSidebar` test, mutation-verified red by name. W2–W4 remain as follow-ups.
