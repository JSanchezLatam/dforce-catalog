# Design: Sidebar Redesign

## Technical Approach

Almost everything already exists. shadcn's `Sidebar` supports `variant="inset"` (`sidebar.tsx:224-239`, `SidebarInset` at `:305-316`). The rail's tooltips (`:512-546`), the Tablero rail dropdown (`app-sidebar.tsx:142-177`), the badge dot (`:86-95`), the collapse cookie (`nav-collapse-state.ts`) and the `pointer-coarse:` 44px floor on menu, sub-menu and label rows (`sidebar.tsx:403,487-488,682`) all stay. The change is classes on those primitives, one pure module (`nav-search.ts`) and one client component (`NavSearch.tsx`). The visual contract is `mockup/index.html`.

## Architecture Decisions

| # | Topic | Choice | Rejected | Rationale |
|---|---|---|---|---|
| D1 | Panels | `app-sidebar.tsx:285`: `variant="inset"`. In `layout.tsx`, the `SidebarProvider` className overrides the wrapper's `has-data-[variant=inset]:bg-sidebar` (`sidebar.tsx:141`) with `bg-muted dark:bg-background`. `sidebar.tsx:245` inner gains `group-data-[variant=inset]:rounded-2xl border border-sidebar-border shadow-sm bg-background dark:bg-sidebar`. `SidebarInset` gets `lg:rounded-2xl lg:border dark:bg-card` from the layout. | `variant="floating"` (no content card); new `--page`/`--panel` tokens | The mockup's `--page`/`--panel`/`--content` are aliases of existing tokens (mockup lines 10-12, 25, 40). The theme stays shadcn neutral (AGENTS.md). Inset spacing is already `lg:`-gated (`sidebar.test.tsx:99`). |
| D2 | Sheet panel | Mobile `SheetContent` (`sidebar.tsx:185-197`): `showCloseButton={false}` replaces the `[&>button]:hidden` hack. It renders our own `SheetClose` with `Button size="icon"` and `min-h-11 min-w-11`, `aria-label="Cerrar menú"`, absolute top-right. Panel: `m-2 h-[calc(100%-1rem)] rounded-2xl border`, width `min(20rem, 100vw - 1rem)`. The sr-only title and description become "Menú" and "Navegación principal". | Close button in `app-sidebar` header via `isMobile` | It stays inside the primitive: the sheet only mounts on the client when `isMobile`, so there is no SSR branch. Spanish for user-facing a11y text is a standing rule. Mockup sheet: 320px tablet, full width minus 16px phone. |
| D3 | Active child | Pure `activeChildHref(children, pathname)` (longest prefix, from `app-sidebar.tsx:146-149`) used by `NavParentExpanded` (`SidebarMenuSubButton isActive`) and `NavParentCollapsed` (`SidebarMenuButton isActive={!!active}` on the trigger, bold item in the dropdown). Links and sub-links set `aria-current="page"` when active. | `startsWith` per child | `/tablero` prefixes `/tablero/clientes`. The existing rail tests (`app-sidebar.test.tsx:313-320`) pin it. |
| D4 | Pill and labels | `SidebarMenuButton`/`SubButton` `data-active` already paints `--sidebar-accent`; add `data-active:font-semibold`. Labels get `text-muted-foreground` from `app-sidebar` (not the primitive, whose `/80` and `/70` contrast pin at `sidebar.test.tsx:66` stays). Drop both `SidebarSeparator` uses. Chevron: `opacity-0 group-hover/label:opacity-100 group-focus-visible/label:opacity-100 pointer-coarse:opacity-100`, plus `opacity-100` when the group is closed. | Hiding the chevron with JS | CSS only, so the server render is the same for every device (Testing limit 2). |
| D5 | User card | The trigger gets `rounded-xl border border-sidebar-border bg-sidebar dark:bg-sidebar-accent`. Menu `side={collapsed ? "right" : "top"}` with `align` stretched to the card width. Items unchanged. | A new component | Restyle only. Mockup lines 110-118, 127. |
| D6 | Search filter | `src/modules/layout/nav-search.ts`: `fold(s)` (NFD, strip `\p{M}`, lowercase, same as `agenda/items.ts:179`); `filterNavGroups(groups, query) → NavGroup[]` (identity for a blank query); `firstHref(groups)`; `highlight(label, query) → {before, match, after} \| null`. A parent label match keeps every child. A child match keeps the parent with only the matching children. Group labels are not matched. | Server-side search; a fuzzy library | Input is the already-permission-filtered `navGroups` prop (`nav-items.ts:97`), so it cannot widen access. The highlight index maps 1:1 because each precomposed Spanish letter folds to one char. |
| D7 | Search state | `query` lives in `AppSidebar` `useState("")`. While it is non-empty, the open state passed to every group and parent `Collapsible` is `true`, and `onOpenChange` is a no-op, so `handleToggleGroup` (`app-sidebar.tsx:274-282`) never runs and the cookie is never written. Clearing the query falls back to `collapseState`. | Writing "open" then restoring | Restoring would race a second tab (the reason `:276-278` re-reads the cookie). |
| D8 | Keyboard | `NavSearch` handles `Esc` (clear) and `Enter` (`router.push(firstHref)`, then clear) in the input's `onKeyDown`. `/` is a `window` keydown listener in a `useEffect`. It ignores modifiers and `input`/`textarea`/`select`/`isContentEditable` targets, and returns while `isMobile && !openMobile`. In the rail it calls `setOpen(true)` and sets a `focusPending` ref. An effect on `state === "expanded"` focuses the input and clears the ref. | Focusing in the click handler | The input is `hidden` in the rail until the width transition starts. A ref plus an effect avoids `setState` in an effect (lint rule). |
| D9 | Rail icon | In the rail, `NavSearch` renders a `SidebarMenuButton` ("Buscar en el menú", tooltip "Buscar") that runs the D8 rail path. The input and the `/` chip are `group-data-[collapsible=icon]:hidden`. The chip also gets `pointer-coarse:hidden`, and the input gets `pointer-coarse:h-11 pointer-coarse:text-base` (16px stops iOS zoom). | `type="search"` native clear | The native ✕ collides with the chip (mockup line 78). |
| D10 | Empty state | With no hits, `SidebarContent` renders `<p>Sin resultados para «{query}».</p>` instead of groups. | Hiding the list silently | Mockup line 354. |

Constraints this design keeps:
- **Insecure context.** The app is plain HTTP on a LAN. Nothing here uses `crypto.randomUUID`, the clipboard or any other secure-context API. `String.prototype.normalize` and `useRouter` are safe.
- **44x44.** The sheet close button gets `min-h-11 min-w-11`. Rows, labels and the input rise through `pointer-coarse:`. The rail and desktop sizes are unchanged.
- **jsdom limit.** No test sees a rendered size, a media query or a hydration mismatch. The classes are pinned in units. Sizes, panel look, contrast and console get checked at `http://192.168.0.7:3000` from a second machine.
- **Hydration.** An empty query renders the unfiltered nav, and `useIsMobile` already returns `false` on the server (`use-mobile.ts:20-26`). The `/` listener and the focus effect run after mount.

## Data Flow

    layout.tsx ─ getNavGroups(user, badges) → <AppSidebar navGroups initialCollapseState>
    AppSidebar ─ query ─┬ NavSearch (input / rail icon, Esc, Enter → router.push(firstHref))
                        └ filterNavGroups(navGroups, query) → groups (open forced while query ≠ "")
                                                            └ none → "Sin resultados para «q»."

## File Changes

| File | Action |
|---|---|
| `src/components/ui/sidebar.tsx` (+`sidebar.test.tsx`) | Modify (D1 inner panel, D2 sheet) |
| `src/app/(app)/layout.tsx` | Modify (D1 variant, page and content classes) |
| `src/components/app-sidebar.tsx` (+`app-sidebar.test.tsx`) | Modify (D3-D5, D7, D10, wiring) |
| `src/modules/layout/nav-search.ts` (+`nav-search.test.ts`) | Create (D6) |
| `src/modules/layout/NavSearch.tsx` (+`NavSearch.test.tsx`) | Create (D8, D9) |

## Interfaces

```ts
export function fold(s: string): string;
export function filterNavGroups(groups: NavGroup[], query: string): NavGroup[];
export function firstHref(groups: NavGroup[]): string | undefined;
export function highlight(label: string, query: string): { before: string; match: string; after: string } | null;
// NavSearch
{ query: string; onQueryChange(q: string): void; firstHref: string | undefined }
```

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit (node) | `fold`, `filterNavGroups` (parent self-match, child match, empty group hidden, blank identity, técnico nav has no "Gestión de usuarios"), `firstHref`, `highlight` | Mutation-verify each branch and name the red test |
| jsdom | Active child in both modes, `aria-current`, no separators, chevron classes, user menu items, sheet close (`matchMedia` stub as `use-mobile.test.tsx:9-18`), search render, empty state, cookie untouched, `/` exclusions, Esc, Enter → mocked `useRouter().push`, rail icon expands and focuses | `component-testing` skill; the existing `next/navigation` mock gains `useRouter` |
| Browser at `http://192.168.0.7:3000` | Panel look, 44px sheet close and rows, chevron on touch, rail tooltips and dropdown, light and dark, no hydration warning, no page horizontal scroll | Required: no test can see it |

## Threat Matrix

N/A. The change is client-only UI. It has no new route, query or permission. Search operates on data the server already filtered.

## Open Questions

- [ ] The sheet stays open after navigating, today and with `Enter`. Closing it on navigation is a follow-up unless the owner wants it here.
