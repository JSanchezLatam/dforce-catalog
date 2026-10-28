# Proposal: Sidebar Redesign

## Intent

The sidebar reads as a flat column: separators between every group, an active child inside "Tablero" that is not marked, a sheet on tablet and phone that only closes by tapping outside it, and no way to find an entry except by scanning. The owner approved a floating-panel sidebar with search (reference: the Neon console), in the app's own neutral palette. Visual contract: `mockup/index.html`, approved 2026-10-28.

The mockup's open question about "Kanban" is resolved on main (`faaef59`): "Tablero" is a parent of "Órdenes en curso", "Pantalla del taller" and "Pantalla de clientes". The nav content does not change. "Mis números" (técnico only, `metrics.self`) stays in Taller.

## Scope

### In Scope
- Restyle: `variant="inset"` with both panels floating over the page, filled-pill active item (including children in the expanded sidebar, by longest-prefix match), muted group labels without separators, a chevron shown on hover or focus (always on touch, always on a closed group), and a bordered user card. The icon rail keeps its tooltips, the Tablero dropdown and the Vencimientos dot.
- Sheet (below `lg`): a 44x44 "Cerrar menú" button. The sheet's sr-only title and description move to Spanish, because they sit in the same block and are user-facing.
- Search: a client-side filter over the items the viewer already sees. It ignores accents and case, keeps a parent when a child matches, and opens collapsed groups while searching without writing the collapse cookie. `/` focuses the box, `Esc` clears it, `Enter` opens the first result, and an empty result reads "Sin resultados". In the rail, search is an icon that expands the sidebar and focuses the box.

### Out of Scope
- Any change to nav content, order, labels or permissions.
- Closing the sheet automatically after navigating (today it stays open; not mocked).
- A search over pages, customers or orders. This search covers menu entries only.
- Sharing the accent fold with `agenda/items.ts` (follow-up).

## Capabilities

### New Capabilities
- `app-sidebar`: shell look, active item, group labels, icon rail, user card, sheet close, menu search.

### Modified Capabilities
- None. `responsive-layout`'s 44x44 touch floor already covers sidebar items. The new sheet close button is specified in `app-sidebar`.

## Approach

Most of this is class changes on shadcn primitives that already exist. The `inset` variant, `SidebarInset`, `pointer-coarse:` sizes, and the rail's tooltips and dropdown are all present. Search is one pure module (`nav-search.ts`: fold, filter, highlight, first href) and one client component. It filters the `navGroups` prop, which `getNavGroups` has already reduced to the viewer's permissions, so it cannot reveal a hidden link. With an empty query the filter returns its input unchanged, so the server render stays identical.

## Work Units (chained, ≤400 lines each)

| WU | Content | Est. |
|---|---|---|
| 1 | Shell: inset panels, page background, sheet panel and close button | ~170 |
| 2 | Nav restyle: active pill and child match, labels and chevron, separators, user card, rail parent pill | ~260 |
| 3 | `nav-search.ts` pure module | ~200 |
| 4a | Search box: filter render, highlight, empty state, collapse override, Esc and Enter | ~300 |
| 4b | `/` shortcut and rail search icon | ~170 |
| 5 | Browser verification, verify, archive (docs) | docs |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Search state or the `/` listener changes the server render, causing a hydration mismatch | Low | Empty query is the identity; the listener lives in an effect; browser console check at the LAN IP |
| A coarse-pointer chevron or a 44px close button is invisible to jsdom | High | Pin classes in unit tests; measure at the LAN IP on a tablet |
| Dark content panel on `--card` blends with page cards | Med | LAN check in dark on list pages |
| Search writes the collapse cookie | Low | Unit test asserts `document.cookie` is unchanged |

## Rollback Plan

Revert the chain by WU, in reverse order. No data, migration or API changes. WU1 reverts alone to the flat sidebar.

## Success Criteria

- [ ] The sidebar matches the mockup at desktop, rail, tablet and phone, in light and dark, at `http://192.168.0.7:3000`.
- [ ] Search finds "Órdenes" from "ordenes", never shows a link the role lacks, and leaves the collapse cookie untouched.
- [ ] Every touch control in the sheet is at least 44x44. The console shows no hydration warning.
