# Design: Mobile Responsive Pass

## Technical Approach

CSS-only, no viewport JS, no new dependency. Fix the four root causes in shared primitives first, then sweep pages. Every phone/desktop split is two server-rendered presentations of one `items` array, toggled by `md:hidden` / `hidden md:block`, as `/vencimientos` already does (`vencimientos/page.tsx:104,131`). Ships as chained PRs off a draft tracker branch `feat/mobile-responsive-pass`.

## Architecture Decisions

| Topic | Choice | Rejected | Why |
|---|---|---|---|
| Card rendering | The same server component maps `items` twice: the existing table in `<Card className="hidden md:block" data-testid="<list>-table">` plus `<RecordCardList testId="<list>-cards">` | `useIsMobile` branch; one component with two modes | A JS branch is a hydration mismatch (server snapshot `false`). Two plain renders of one array cannot drift. |
| Card chrome | One small `src/shared/ui/RecordCard.tsx`, used by 4 lists and 2 history tables. Card bodies stay inline in each page. | A generic column-config card | Each list shows different fields, so a column config would be an abstraction with one shape per caller. |
| Users card | No `href`. The card's `action` slot holds the existing `RowActions` kebab. | Whole card as a link | `/users` has no detail page. Its row actions are Editar and Desactivar. |
| Test duplicates | Scope every row query with `within(getByTestId("<list>-table" \| "<list>-cards"))`, and add one "same count in both" test per list | Injecting CSS into jsdom | jsdom applies no Tailwind, so both presentations are in the DOM, and `getByText` ignores visibility anyway. |
| 44px floor | `pointer-coarse:min-h-11 pointer-coarse:min-w-11` on the button base. `pointer-coarse:h-11` on Input, SelectTrigger, sidebar menu/sub/group-label buttons and Pagination items. Checkbox `after:-inset-3.5` (16+28=44). | Changing `size: default` to `h-11`; adding classes per call site | Mouse desktops stay unchanged (success criterion 3). Tablets and phones get 44px. Existing unconditional `min-h-11 min-w-11` call sites stay as they are. |
| Filter-strip exception | Kept for fine pointers only. On touch, inputs AND buttons rise to 44 together, so the strip still reads as one control. This also matches the mockup's `h-11` fields and fixes "Limpiar" (#10). | Opting the strip out of the floor | The audit flags "Limpiar" as a finding. |
| Pagination | It is fixed in this change, and the AGENTS.md exception is removed. Changes: `flex-wrap`, 44px items on touch, "Página X de Y" `basis-full` below `sm` | Keeping it as its own change | Audit #5 is in scope. |
| Colour | Raw palette pairs with a `dark:` twin, kept in the few shared owners: `StatusBadge` maps (mockup `CHIP`), `Toast` maps, `button`/`alert` destructive (`text-red-700 dark:text-red-400`, the badge.tsx precedent), `FIELD_ERROR`, and a new `SUCCESS_TEXT` in `styles.ts` (5 copies of `text-green-600`). Checkbox border is `border-muted-foreground`. Avatar is `text-primary-foreground`. | New `--success-text`/`--warning-text` tokens in `globals.css` | The palette is stock shadcn and has flipped twice (AGENTS.md). badge.tsx already sets the pattern. |
| Contrast targets | Text ≥ 4.5:1, checkbox border ≥ 3:1 (WCAG 1.4.11), both themes, against the blended ground. Measured in a browser with the mockup's `measure()` method and recorded in a comment beside each class, as badge.tsx does. | Numbers taken from the palette | A ratio nobody measured is a claim nobody checked. |
| Page header | Server `PageHeader({title, description?, actions?})`. `PAGE_HEADING` becomes `text-2xl sm:text-[32px] leading-tight`. Page wrappers go from `p-8` to `p-4 sm:p-8`. | A layout-level padding change | The print page and `loading.tsx` each own their padding. |
| Refusal | `PermissionDenied({title})` uses `PageHeader`, then a card with a lock icon, "No tenés permiso para ver esta página", "Pedile acceso a un administrador." and a 44px link to `/` labelled "Volver al inicio" | Keeping the sentence | Mockup panel 5. All 16 copies take the page title. |
| Regressions in the sweeps | `src/app/responsive-guards.test.ts` scans `src/app/(app)/**/page.tsx` for a bare `p-8` and for the refusal literal outside `PermissionDenied` | Nothing | Same idea as `route-guards.test.ts`. A mechanical sweep is otherwise unprovable. |
| Sidebar (#17) | The off-canvas breakpoint moves from `md` to `lg`: `use-mobile.ts` 768→1024, `md:` → `lg:` in `sidebar.tsx`, top bar `md:hidden` → `lg:hidden` | A collapsed rail on tablets | Today at 768-1023 nothing visible collapses the sidebar (`SidebarRail` only). The rail stays desktop-only, which keeps its 32px waiver true. |

## Interfaces

```tsx
// src/shared/ui/PageHeader.tsx — no "use client"
export function PageHeader(p: { title: string; description?: ReactNode; actions?: ReactNode }): JSX.Element
// src/shared/ui/PermissionDenied.tsx
export function PermissionDenied(p: { title: string }): JSX.Element
// src/shared/ui/RecordCard.tsx
export function RecordCardList(p: { testId: string; children: ReactNode }): JSX.Element // <ul md:hidden>
export function RecordCard(p: { href?: string; action?: ReactNode; children: ReactNode }): JSX.Element
```

Card fields follow the mockup. Status pills reuse `statusBadgeClassName`, the vencimientos precedent: Activo → `completed`, Desactivado and Sin stock → `failed`. Inventory price renders as `$x.toFixed(2)` (as on `inventory/[id]`) and is not sortable, so the `queries.ts:82` comment is updated.

## Slices (chained, ≤400 lines incl. tests)

| # | PR | Findings | Est. |
|---|---|---|---|
| 1 | Colour | #6 #7 #19 #20 #21 #22 + the same-root `text-destructive` users | ~220 |
| 2 | Touch floor + Pagination + AGENTS.md 44px paragraph | #5 #9 #10 | ~260 |
| 3 | `PageHeader`, responsive `PAGE_HEADING`, `p-4 sm:p-8`, guard test; inventory title moves above the greeting, greeting `hidden md:flex` | #1 #11 #12 #14 | ~350 |
| 4 | `PermissionDenied` across 16 sites, 7 test asserts updated | #18 | ~220 |
| 5 | `RecordCard` + service-orders | #2 | ~300 |
| 6 | Customers + customer and vehicle history tables | #2 #4 | ~330 |
| 7 | Inventory cards + desktop Precio/Stock columns | #2 | ~300 |
| 8 | Users cards | #2 | ~280 |
| 9 | Per-screen fixes: Marca `min-w-0`, sync notice wrap, customer header `flex-col sm:flex-row`, order id `slice(0,8)`, social rows, Spanish file label, template preview | #3 #8 #13 #15 #16 #17b | ~280 |
| 10 | Sidebar breakpoint `lg` | #17a | ~80 |

Why this order: primitives first, so later PRs inherit final chips and 44px controls. Headers before cards, so each list page body is rewritten once on a stable wrapper. The cross-cutting nav change goes last so it can be reverted alone.

**Verification per PR**: open the app at the LAN IP from a second device, at 390, 768 and 1280, dark and light, as admin and técnico.

- PR 1: contrast numbers are measured.
- PR 2: confirm 1280 with a mouse is pixel-unchanged. At 768 on touch, check `/builder` and the dialogs (the close X must not overlap the title).
- PRs 5-8: no `scrollWidth` above the viewport, and the whole card opens the record.
- PR 10: check the 768, 1024 and 1280 navigation.

The final gate is re-running the audit with 0 findings.

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit (node) | Variant class strings (`pointer-coarse:`, colour pairs), the guard scan | String assertions, mutation-verified by name |
| Component (jsdom) | PageHeader, PermissionDenied, RecordCard, list cards, scoped table rows | `render(await Page())`, `within(testid)` |
| Browser | Layout, contrast, hit size, hydration | The LAN matrix above. jsdom sees none of these. |

## Threat Matrix

N/A: no routing, shell, subprocess, VCS automation or process boundary.

## Migration / Rollout

No migration required. Revert PRs in reverse order.

## Open Questions

- [x] (Owner approved 2026-10-05: admin keeps the stats card on phones, fixed to fit; técnico sees the mockup layout.) Inventory on phones keeps the stats card, because it holds the admin's "Sincronizar inventario". The mockup's técnico panel shows only a subtitle. Confirm this deviation.
- [x] (Owner approved 2026-10-05.) PR 1 also fixes `FIELD_ERROR`, `alert` destructive, `LogoutButton` and `InventoryCatalogHandoff` (the same dark-maroon-as-text root as #7). This is an explicit addition and can be dropped if the owner objects.
- [x] (Owner approved 2026-10-05.) Sidebar off-canvas breakpoint moves from 768 to 1024 (tablets get the ☰ like phones), shipped as the last PR alone so it can be reverted on its own.
