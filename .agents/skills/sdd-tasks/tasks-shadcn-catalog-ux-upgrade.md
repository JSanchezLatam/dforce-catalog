# SDD Tasks: shadcn-catalog-ux-upgrade

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~680 |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | 2 PRs: **PR1** (R-1, R-2, R-3, R-4, R-9, R-10, R-11) ~390 lines; **PR2** (R-5, R-6, R-7, R-8, R-12, R-13) ~290 lines |

---

## T-1: Custom Checkbox component + replace native checkboxes
- **Requirements covered**: R-1
- **Files to create**: `src/shared/ui/Checkbox.tsx`
- **Files to modify**: `src/modules/catalog-builder/CatalogBuilderForm.tsx`
- **Description**:
  1. Create a `Checkbox` client component in `src/shared/ui/Checkbox.tsx` wrapping a hidden native `<input type="checkbox">` with a styled decorative `<span>` using `lucide-react`'s `Check` icon for the checked state
  2. Props: `checked: boolean`, `onChange: () => void`, `children?: ReactNode`, optional `className`
  3. Style: rounded border (`rounded-md border border-dash-border bg-dash-bg`), on checked: `bg-dash-purple border-dash-purple`, transition on all, focus-visible ring
  4. Replace all `<input type="checkbox">` in `CatalogBuilderForm.tsx` (lines 183, 193-197, 219-224) with the new `<Checkbox>` component
- **Estimated lines**: 70
- **Test strategy**: Unit test: renders unchecked, renders checked, fires onChange on click, renders children label
- **Dependencies**: none
- **Risk**: low

---

## T-2: Dash-card wrapper around CatalogTemplate preview in builder
- **Requirements covered**: R-2, R-11
- **Files to modify**: `src/modules/catalog-builder/CatalogBuilderForm.tsx`
- **Description**:
  1. Find the `<section aria-label="Live preview">` block (lines 294-310 in CatalogBuilderForm.tsx)
  2. Wrap the entire section content (skip the `<h2>` heading) in a `<div className={CARD}>` to visually lift the preview
  3. This mirrors the same treatment applied to the template config preview section
- **Estimated lines**: 5
- **Test strategy**: Visual check only
- **Dependencies**: none
- **Risk**: low

---

## T-3: Login form client-side validation
- **Requirements covered**: R-3
- **Files to modify**: `src/modules/auth/LoginForm.tsx`
- **Description**:
  1. Add `required` attribute to both username and password `<input>` elements
  2. Add a `fieldErrors` state (`Record<string, string>`) alongside existing `error` state
  3. Disable the submit button when either field is empty (`disabled={status === "submitting" || !username || !password}`)
  4. Add `onBlur` handlers on each input that validate the field and set/clear `fieldErrors` (empty field → "Required")
  5. Render per-field error messages below each input using `FIELD_ERROR` class
- **Estimated lines**: 30
- **Test strategy**: Unit test: empty fields disable submit, blur sets error, filling clears error
- **Dependencies**: none
- **Risk**: low

---

## T-4: Product search/filter input in catalog builder
- **Requirements covered**: R-4
- **Files to modify**: `src/modules/catalog-builder/CatalogBuilderForm.tsx`
- **Description**:
  1. Add a `searchQuery` state (`string`, default `""`) in the client component
  2. In the product selection section (between the `<h2>` and the `<ul>`), render a text `<input>` with search icon (use `Search` from lucide-react inline), styled with `INPUT` class, placeholder "Search products…"
  3. Derive `filteredCandidates` from `activeCandidates` by filtering where `product.name.toLowerCase().includes(searchQuery.toLowerCase())`
  4. Map over `filteredCandidates` instead of `activeCandidates` for the product list
- **Estimated lines**: 25
- **Test strategy**: Unit test: search filters product list by name (case-insensitive), empty search shows all
- **Dependencies**: none
- **Risk**: low

---

## T-5: Animation utilities (transitions, pulse, fade-in)
- **Requirements covered**: R-9
- **Files to create**: `src/shared/ui/animations.ts`
- **Description**:
  1. Create a utility file exporting Tailwind class strings for common animations
  2. Export `FADE_IN = "animate-in fade-in duration-200"`, `PULSE = "animate-pulse"`, `TRANSITION = "transition-all duration-200"`, `SLIDE_DOWN = "animate-in slide-in-from-top-1 duration-200"`
  3. These are Tailwind v4 animate classes — verify they're available (if not, add `@utility` directives in globals.css)
- **Estimated lines**: 15
- **Test strategy**: Import class string check only
- **Dependencies**: none
- **Risk**: low

---

## T-6: Focus-visible ring styles
- **Requirements covered**: R-10
- **Files to modify**: `src/app/globals.css`
- **Description**:
  1. Add a global `focus-visible` style to globals.css:
  ```css
  @layer base {
    *:focus-visible {
      @apply outline-2 outline-offset-2 outline-dash-purple;
    }
  }
  ```
  2. Verify the `outline-dash-purple` color variable is already registered (yes, `--color-dash-purple`)
  3. Ensure no existing component overrides get broken (the `INPUT` class already has `focus:outline-none` which is fine — `focus-visible` is a separate pseudo-class)
- **Estimated lines**: 8
- **Test strategy**: Visual check: tab through interactive elements to verify purple ring appears
- **Dependencies**: none
- **Risk**: low

---

## T-7: Numbered pagination component
- **Requirements covered**: R-5
- **Files to create**: `src/shared/ui/Pagination.tsx`
- **Files to modify**: `src/app/(app)/inventory/page.tsx`
- **Description**:
  1. Create a `Pagination` component in `src/shared/ui/Pagination.tsx` — server-compatible (no "use client", just renders `<Link>` elements)
  2. Props: `currentPage: number`, `pageCount: number`, `buildHref: (page: number) => string`
  3. Render numbered page buttons: for small ranges (≤7 pages) show all; for larger ranges show first, last, current with `…` gaps using the "sliding window" pattern (e.g. 1 … 4 5 6 … 10)
  4. Style: flex row gap-1; active page: `bg-dash-purple text-dash-fg rounded-lg px-3 py-1 text-sm`; inactive: `text-dash-muted hover:text-dash-fg rounded-lg px-3 py-1 text-sm`
  5. Replace the previous/next navigation block in `inventory/page.tsx` (lines 111-125) with `<Pagination currentPage={pageWindow.page} pageCount={pageCount} buildHref={(p) => buildPageHref(params, p)} />`
- **Estimated lines**: 60
- **Test strategy**: Unit test: renders correct number of page buttons, current page is highlighted, ellipsis shown for large ranges, buildHref is called correctly
- **Dependencies**: none
- **Risk**: low

---

## T-8: Loading skeletons (loading.tsx per route)
- **Requirements covered**: R-6
- **Files to create**:
  - `src/app/(app)/inventory/loading.tsx`
  - `src/app/(app)/builder/loading.tsx`
  - `src/app/(app)/catalogs/loading.tsx`
  - `src/app/(app)/template-config/loading.tsx`
  - `src/app/login/loading.tsx`
- **Description**:
  1. Each `loading.tsx` exports a default function returning a `<main className="p-8">` with skeleton placeholders matching the page's layout
  2. For listing pages (inventory, catalogs): render a `PAGE_HEADING` sized gray block, then a `CARD`-sized block with multiple row-shaped `<div>`s using `animate-pulse bg-dash-muted/20 rounded-lg`
  3. For form pages (builder, template-config): same heading skeleton + form-shaped blocks
  4. For login: centered card skeleton mimicking the login card shape
  5. Leverage the `PULSE` utility from T-5 where applicable
- **Estimated lines**: 70
- **Test strategy**: Visual check during page navigation
- **Dependencies**: T-5 (animation utilities)
- **Risk**: low

---

## T-9: Toast notification system
- **Requirements covered**: R-7
- **Files to create**:
  - `src/shared/ui/toast.tsx`
  - `src/shared/ui/toast-context.tsx`
- **Files to modify**: `src/app/layout.tsx`, `src/modules/inventory-sync/ManualSyncButton.tsx`
- **Description**:
  1. Create a `ToastContext` + `ToastProvider` in `toast-context.tsx`:
     - Context provides `addToast(message: string, type: "success" | "error" | "info")` and `removeToast(id: string)`
     - Provider manages a `toasts` state array, auto-dismisses after 5s
     - Renders a fixed `bottom-4 right-4` toast container as a portal
  2. Create a `Toast` component in `toast.tsx`:
     - Props: `id`, `message`, `type`, `onDismiss`
     - Styled pill with lucide icon (CheckCircle/AlertCircle/Info), bg mapping (green/red/blue), fade-in animation from T-5
  3. Wrap `<ToastProvider>` in `src/app/layout.tsx` around `{children}`
  4. Replace the inline `<p role="status">` message in `ManualSyncButton.tsx` with `addToast()` calls from the toast context
- **Estimated lines**: 100
- **Test strategy**: Unit test: addToast renders a toast, auto-dismisses after timeout, removeToast works, multiple toasts stack
- **Dependencies**: T-5 (animation utilities for fade-in)
- **Risk**: medium — touches root layout, portal rendering needs SSR care (use `useEffect` guard)

---

## T-10: Auto-refresh for catalogs in-progress
- **Requirements covered**: R-8
- **Files to modify**: `src/app/(app)/catalogs/page.tsx`
- **Description**:
  1. The catalogs page is currently a Server Component — this is a challenge for client-side polling. Instead, add a "use client" wrapper component `CatalogPollProvider` (or inline in a separate file)
  2. Create `src/modules/catalog-storage/CatalogPollProvider.tsx`:
     - Props: `initialCatalogs: Catalog[]` (passed from server component)
     - State holds catalogs, initialised with `initialCatalogs`
     - `useEffect` with `setInterval(fetch, 5000)` that calls `/api/catalogs/list` (or reuses the existing `/api/catalogs` route), returning updated catalog rows
     - Only re-fetches if at least one catalog has non-terminal status (`pending`, `uploading`, `running`)
     - Cleans up interval on unmount and when all catalogs are terminal
  3. Extract the `CatalogRow` rendering and table into a client component that receives the catalog array and renders the same markup
  4. Server page passes `catalogs` as `initialCatalogs` to the provider
  - **Alternative** (simpler): create a minimal `"use client"` wrapper `CatalogsClient` that accepts `catalogs` as initial data and runs the 5s poll, re-rendering the table. Move the table markup from the server page into this client component.
- **Estimated lines**: 80
- **Test strategy**: Manual: check that /catalogs refreshes status badges every 5s for in-progress catalogs
- **Dependencies**: T-13 (status icons in StatusBadge — nice to have for visual update), R-6 (loading skeleton for initial load)
- **Risk**: medium — introduces polling to a server page, requires client boundary extraction

---

## T-11: Loading state on logout button
- **Requirements covered**: R-12
- **Files to modify**: `src/modules/layout/LogoutButton.tsx`
- **Description**:
  1. Add a `status` state (`"idle" | "submitting"`) to the client component
  2. In `handleClick`, set `setStatus("submitting")` before the fetch, and keep it during the request
  3. Add `Loader2` from lucide-react (spinner icon)
  4. Replace `LogOut` icon with `<Loader2 className="animate-spin" />` when `status === "submitting"`
  5. Add `disabled` prop to the button during submitting state
  6. Optional: wrap in a `<div className="relative">` to maintain icon size consistency
- **Estimated lines**: 15
- **Test strategy**: Visual check: clicking logout shows spinner, button is disabled
- **Dependencies**: T-5 (for `animate-spin` or define inline)
- **Risk**: low

---

## T-12: Status icons in StatusBadge
- **Requirements covered**: R-13
- **Files to modify**: `src/shared/ui/StatusBadge.tsx`, `src/shared/ui/StatusBadge.test.ts`
- **Description**:
  1. Import lucide icons: `Loader2` (running/uploading), `CheckCircle` (completed/uploaded), `XCircle` (failed), `Clock` (pending)
  2. Create a `STATUS_ICON` mapping: `Record<BadgeStatus, typeof Loader2>`
  3. Render the icon inside the badge `<span>`, before the label text, with `aria-hidden="true" size={12} className="inline-block mr-1"`
  4. For `running` and `uploading` statuses, add `className="animate-spin"` to `Loader2`
  5. Update the `statusBadgeClassName` function if needed (icon and text now need `inline-flex items-center gap-1` instead of `inline-block`)
  6. Update `StatusBadge.test.ts` to verify the component renders with icon element present
- **Estimated lines**: 25
- **Test strategy**: Unit test: each status renders correct icon, running/uploading icon has animate-spin class
- **Dependencies**: T-5 (for animate-spin)
- **Risk**: low

---

## Task dependency graph

```
T-1 (Checkbox)         → T-4 (Product search)
T-5 (Animations)       → T-8 (Skeletons), T-9 (Toasts), T-11 (Logout spinner), T-12 (Status icons)
T-7 (Pagination)       → (independent, no deps)
T-2 (Preview card)     → (independent, no deps)
T-3 (Login validation) → (independent, no deps)
T-6 (Focus rings)      → (independent, no deps)
T-10 (Auto-refresh)    → T-12 (Status icons)
T-13 (unused)
```

## PR split

**PR1** (~390 lines): T-1, T-2, T-3, T-4, T-5, T-6, T-11 — self-contained UI improvements, no new infrastructure.

**PR2** (~290 lines): T-7, T-8, T-9, T-10, T-12 — polling, skeletons, toasts, pagination, status icons. All depend on T-5 (animations) which ships in PR1.
