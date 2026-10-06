# Proposal: Mobile Responsive Pass

## Intent

The app is used from phones on the workshop LAN, and the 2026-10-05 audit (`audit/audit.md`) found 22 defects at 390px across both roles and themes: lists wider than the screen with the only row action off-screen, buttons under 44px, and text under 4.5:1 contrast. 13 are identical for every role and theme, so four shared root causes explain most of them. Owner decisions (2026-10-05) are final: fix every finding, root causes first.

## Scope

### In Scope
- Colour (#6, #7, #19-#22): text roles ≥ 4.5:1 in dark AND light; no single-theme raw colour.
- Touch floor (#5, #9, #10): 44x44 on buttons, sidebar items, pagination, dialog close, row checkboxes — once, in the shared primitives.
- Shared page header (#1, #11, #12, #14, #15): title + actions that wrap, responsive title size, `p-4 sm:p-8`.
- Shared permission-refused screen (#18): explanation + "Volver" link, replacing the 16 hand-copied sentences.
- Phone card lists (#2, #4): below `md`, each list table renders one card per record (key fields only, whole card opens the record), modelled on `/vencimientos`. Desktop table unchanged.
- Per-screen fixes: #3 Marca select, #8 sync notice, #13 customer header, #16 social rows and Spanish file button, #17 template preview and sidebar at 768.

### Out of Scope
- New features; desktop redesign; `/builder` and `/template-config` on phones.
- Mockup `mockup/` (cards, shared header, shared no-permission screen, colour fixes): **approved by the owner as-is 2026-10-05**.
- Inventory price and stock: **owner decision 2026-10-05** — shown on the phone cards AND added as columns to the desktop inventory table (data already loaded, never shown).
- Bulk selection on phone cards: **owner decision 2026-10-05 — option 1**, phone cards carry no checkboxes; bulk actions stay tablet/desktop (`md` and up).

## Capabilities

### New Capabilities
- `responsive-layout`: cross-cutting rules with no current home — shared page header and padding, the 44px touch floor, the permission-refused screen, text contrast in both themes.

### Modified Capabilities
- `table-bulk-actions`: phone card layout for the four list tables; checkbox selection and bulk bar are `md`-and-up only.

## Approach

CSS-first, no viewport JS (no hydration risk): cards and table both rendered, toggled with `md:hidden` / `hidden md:block`. Colour fixes copy the `badge.tsx:16-33` pattern (`text-red-700 dark:text-red-400`). Touch floor via `pointer-coarse:` minimums on base variants, not per call site.

Chained PRs by root cause: (1) colour; (2) touch floor; (3) page header + refusal screen; (4) phone card lists; (5) per-screen fixes. Each verified at the LAN IP, 390px, both themes, both roles.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/components/ui/{button,checkbox,sidebar,dialog,table}.tsx`, `src/shared/ui/{Pagination,StatusBadge,Toast,styles}.ts(x)` | Modified | Floors, colour, wrap |
| `src/app/globals.css` | Modified | Text-role tokens |
| `src/shared/ui/` | New | Page header, refusal screen |
| `src/app/(app)/**/page.tsx`, `UsersTable.tsx` | Modified | Header, padding, cards |
| `src/modules/{customers,inventory-view,workshop-config,template-config,catalog-builder,account}/` | Modified | Per-screen fixes |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Dual-render duplicates text; tests find two matches | High | Scope queries to the visible container |
| PR 3 touches ~36 pages, over budget | Med | Split by route group |
| `pointer-coarse:` floor enlarges tablet desktop layouts | Med | Check 768 and 1280 in each PR |
| Layout/contrast invisible to jsdom | High | Browser check at LAN IP per PR |

## Rollback Plan

Revert PRs in reverse order. No migrations, no data, no API changes.

## Dependencies

- Owner-approved mockup of the phone card list, the shared header, and the refusal screen before apply.

## Success Criteria

- [ ] Re-running the audit at 390px yields 0 findings in all four role/theme combinations.
- [ ] No page `scrollWidth` exceeds the viewport; every action control ≥ 44x44 on touch.
- [ ] Desktop (1280) list pages unchanged.

## Proposal question round

Proposed default: phone cards have NO selection; bulk actions stay `md`-and-up (simplest; a técnico on a phone loses bulk customer deactivation). Owner to confirm, or require selection on cards.
