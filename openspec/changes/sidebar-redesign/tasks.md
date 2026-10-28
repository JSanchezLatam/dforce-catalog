# Tasks: Sidebar Redesign

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,100 across 5 code PRs plus a docs PR (tests counted); per-PR 170-300 |
| 400-line budget risk | Low (WU4a ~300 is the largest) |
| Chained PRs recommended | Yes |
| Suggested split | WU1 → WU2 → WU3 → WU4a → WU4b → WU5 |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain (tracker `design/sidebar-redesign` → main) |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: Low

Branches: WU1 targets `design/sidebar-redesign`. Each later `feat/sidebar-redesign-<slug>` targets the previous WU branch. Slugs: `wu1-shell`, `wu2-nav`, `wu3-search-core`, `wu4a-search-box`, `wu4b-search-keys`, `wu5-signoff`. A child that shows parent changes has the wrong base. Run GGA (`gga run --pr-mode --diff-only`, pin `PR_BASE_BRANCH`) before each PR.

WU3 owns only new files, disjoint from WU1 and WU2, so it can be written in parallel and rebased into the chain.

Conventions for every WU:
- **Strict TDD.** Write the RED test first and confirm it fails by name, then make it GREEN.
- **Mutation-verify every rule.** Revert the fix and name the test that turns red.
- **Mocks match reality.** `navGroups` fixtures use the real `NavGroup` shape.
- **No secure-context API.**
- **44x44 through `pointer-coarse:`.** jsdom sees classes, not sizes.
- **Gates.** `npm test`, `npx tsc --noEmit` and `npm run lint` (0 errors, 13 warnings, no new ones).

### Suggested Work Units

| Unit | Goal | Likely PR | Owns | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|------|----------------------|-----------------|-------------------|
| 1 | Shell panels, sheet close (~170) | PR 1 → tracker | `src/components/ui/sidebar.tsx`, `sidebar.test.tsx`, `src/app/(app)/layout.tsx`, one prop at `app-sidebar.tsx:285` | `npx vitest run src/components/ui/sidebar.test.tsx` | Browser at LAN IP: panels and sheet close | Primitive classes and layout props |
| 2 | Nav restyle (~260) | PR 2 → WU1 | `src/components/app-sidebar.tsx`, `app-sidebar.test.tsx` | `npx vitest run src/components/app-sidebar.test.tsx` | Browser: pill, chevron, rail, user card | `app-sidebar.tsx` |
| 3 | Search core (~200) | PR 3 → WU2 | `src/modules/layout/nav-search.ts`, `nav-search.test.ts` (new) | `npx vitest run src/modules/layout/nav-search.test.ts` | N/A: pure module, no UI | New file, unused until 4a |
| 4a | Search box (~300) | PR 4 → WU3 | `src/modules/layout/NavSearch.tsx`, `NavSearch.test.tsx` (new), `app-sidebar.tsx`, `app-sidebar.test.tsx` | `npx vitest run src/modules/layout src/components/app-sidebar.test.tsx` | Browser: filter, empty, cookie untouched | `NavSearch.tsx` and its wiring |
| 4b | `/` and rail icon (~170) | PR 5 → WU4a | `NavSearch.tsx`, `NavSearch.test.tsx` | `npx vitest run src/modules/layout/NavSearch.test.tsx` | Browser: `/` focus, rail expand and focus | Listener and rail button |
| 5 | Verification, verify, archive (docs) | PR 6 → WU4b | `openspec/` only | `npm test && npx tsc --noEmit` | Owner walk-through at LAN IP | Docs |

## WU1: Shell

- [x] 1.1 RED `sidebar.test.tsx`: the inset inner panel carries `rounded-2xl`, the border and the shadow classes under `group-data-[variant=inset]`; the existing `lg:` spacing pins stay green.
- [x] 1.2 RED `sidebar.test.tsx` (stub `matchMedia` to below 1024 as in `use-mobile.test.tsx:9-18`): the open sheet has a button named "Cerrar menú" with `min-h-11 min-w-11`; clicking it closes the sheet; no English "Close" or "Sidebar" remains in the sheet.
- [x] 1.3 GREEN `sidebar.tsx` (D1 inner classes, D2 `showCloseButton={false}`, own `SheetClose`, floating panel, Spanish title and description).
- [x] 1.4 `app-sidebar.tsx:285`: `variant="sidebar"` → `"inset"` (that one line only; the rest of the file is WU2's). `layout.tsx`: `SidebarProvider` className `has-data-[variant=inset]:bg-muted dark:has-data-[variant=inset]:bg-background`; `SidebarInset` className `lg:rounded-2xl lg:border dark:bg-card`.
- [x] 1.5 Verify: unit, then mutation-verify (drop the close button's `min-h-11`; restore `[&>button]:hidden`).

## WU2: Nav restyle

- [ ] 2.1 RED `app-sidebar.test.tsx`: expanded on `/tablero/clientes` marks only "Pantalla de clientes" with `aria-current="page"` (today none is marked); a top-level link on its page carries `aria-current`; rail on `/kanban` makes the Tablero trigger `data-active`.
- [ ] 2.2 RED: no `[data-sidebar="separator"]`; open-group chevron has `opacity-0` plus the hover, focus-visible and `pointer-coarse:opacity-100` classes, and a closed group's chevron does not have `opacity-0`; labels carry `text-muted-foreground`.
- [ ] 2.3 RED: user card trigger carries the border classes; the menu lists "Mi cuenta", the theme item and "Cerrar sesión" (mock `next-themes` and `useRouter` only if opening the menu requires it).
- [ ] 2.4 GREEN `app-sidebar.tsx` (D3 `activeChildHref`, D4, D5). Existing tests at `:313-342` stay green unchanged.
- [ ] 2.5 Verify: unit, then mutation-verify `activeChildHref` (switch to plain `startsWith`) and the separator removal.

## WU3: Search core

- [ ] 3.1 RED `nav-search.test.ts`: `fold("Órdenes") === "ordenes"`; blank query returns the input unchanged; "pantalla" keeps Tablero with its two matching children only; "tablero" keeps all three children; "ven" keeps Vencimientos and Inventario and drops empty groups; the real `getNavGroups(tecnico)` with "usuarios" yields `[]`; `firstHref` follows display order ("clien" → `/tablero/clientes`); `highlight("Órdenes en curso", "ordenes")` returns `{before: "", match: "Órdenes", after: " en curso"}`.
- [ ] 3.2 GREEN `nav-search.ts` (D6).
- [ ] 3.3 Verify: mutation-verify the parent self-match branch, the empty-group drop and the accent strip.

## WU4a: Search box

- [ ] 4a.1 RED `NavSearch.test.tsx`: the input is named "Buscar en el menú" with placeholder "Buscar…"; `Esc` clears it; `Enter` calls the mocked `router.push` with `firstHref` and clears it; `Enter` with no result does nothing; the `/` chip carries `pointer-coarse:hidden`.
- [ ] 4a.2 RED `app-sidebar.test.tsx`: typing "ven" hides CRM's other links and shows a highlighted "ven"; "facturas" shows "Sin resultados para «facturas»."; with CRM saved as closed, "ven" shows Vencimientos, `document.cookie` is unchanged, and after `Esc` CRM is closed again; clicking a group label while searching writes no cookie.
- [ ] 4a.3 GREEN `NavSearch.tsx` (input, chip, Esc, Enter) and its `app-sidebar.tsx` wiring (D7 forced open, D10 empty state, highlight render).
- [ ] 4a.4 Verify: mutation-verify the forced-open no-op (let it call `handleToggleGroup`, and the cookie test must turn red) and the `Enter` push.

## WU4b: Slash and rail icon

- [ ] 4b.1 RED `NavSearch.test.tsx`: `/` on the body focuses the box and types nothing; `/` inside a page `input`, a `textarea` or a contenteditable, or with Ctrl or Meta held, leaves focus alone; with `defaultOpen={false}`, `/` expands the sidebar and focuses the box; the rail button "Buscar en el menú" does the same; below 1024 with the sheet closed, `/` does nothing.
- [ ] 4b.2 GREEN (D8, D9): window listener in an effect, `focusPending` ref and a focus effect, and the rail `SidebarMenuButton`.
- [ ] 4b.3 Verify: mutation-verify the editable-target guard and the closed-sheet guard.

## WU5: Browser verification and sign-off

Do every check at `http://192.168.0.7:3000` from a second machine, not at localhost. The LAN IP is an insecure context.

- [ ] 5.1 Desktop 1440, light and dark, as administrador:
  - Both panels float over the page.
  - The pill shows on a top-level link and on a Tablero child.
  - The chevron appears only on hover or focus, and stays on a closed group.
  - The user menu opens above the card.
  - `/` focuses the box, and "ordenes" finds "Órdenes en curso" and "Órdenes de servicio".
  - `Enter` navigates.
  - The console has no hydration warning.
- [ ] 5.2 Rail at 1440:
  - Tooltips work, and the Vencimientos dot and tooltip count show.
  - The Tablero dropdown is right of the rail with the current child bold.
  - The search icon expands the sidebar and focuses the box.
- [ ] 5.3 Tablet 820 (touch), light and dark:
  - The sheet opens as a floating panel.
  - "Cerrar menú", the rows, the group labels and the search box each measure at least 44x44.
  - The chevrons are always visible, and no `/` chip shows.
  - Focusing the search box does not zoom.
- [ ] 5.4 Phone 390, light and dark:
  - The same checks as 5.3.
  - The list scrolls while the user card stays pinned.
  - There is no page horizontal scroll.
- [ ] 5.5 As técnico:
  - "Mis números" shows in Taller.
  - Searching "usuarios" shows "Sin resultados para «usuarios».".
- [ ] 5.6 Full gates on the tip: `npm test`, `npx tsc --noEmit` and `npm run lint` (0/13).
- [ ] 5.7 `sdd-verify`. Then merge the chain into the tracker in order, and the tracker into main.
- [ ] 5.8 `sdd-archive`: create `openspec/specs/app-sidebar/spec.md` from the delta.

## Follow-ups

- Close the sheet after navigating (link tap or `Enter`). It stays open today. Not mocked.
- `/kanban` root (`bg-board-canvas`) stops at its content height, so the inset panel shows a white band under it. Pre-existing, now more visible inside the rounded panel.
- Share one `fold` between `agenda/items.ts:179` and `nav-search.ts`.
- Clean the 13 pre-existing lint warnings (separate change).
