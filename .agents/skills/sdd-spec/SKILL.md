# SDD Spec — shadcn-catalog-ux-upgrade

## Change Overview
UI/UX polish pass targeting 13 specific gaps across 6 screens. No new features, no API changes, no new dependencies.

---

## R-1: Builder checkboxes unstyled

**Title**: Custom checkbox component for CatalogBuilderForm

**Description**: The category L1, category L2, and product checkboxes in the builder render as unstyled native browser checkboxes, breaking the dark dash-purple theme.

**Current behavior**: Three `<input type="checkbox">` elements (CatalogBuilderForm.tsx:183, 193, 220) render with the OS default appearance — white/light background that clashes with the `bg-dash-bg` (#0f172a) dark theme.

**Expected behavior**: All three checkboxes are replaced with a custom implementation using `appearance-none`, a visible checked state using `bg-dash-purple` with an SVG checkmark, and proper accessibility attributes. Appearance matches dash-purple accent color when checked, subtle border when unchecked.

**Files affected**:
- `src/modules/catalog-builder/CatalogBuilderForm.tsx` — lines 183, 193, 220 replace native input

**Acceptance criteria**:
- Checkboxes render with `appearance-none` and show a dash-purple (#7c3aed) fill + white SVG checkmark when checked
- Unchecked checkboxes show a subtle border (`border-dash-border` or `border-dash-muted`)
- Each checkbox has `role="checkbox"` and `aria-checked` reflecting current state
- Keyboard interaction (Space to toggle) works natively
- Focus-visible ring appears on keyboard focus

**Constraints**: Only touch checkbox inputs. Do not extract a shared Checkbox component to `shared/ui/` unless at least 3 call sites exist. Do not add any npm dependency.

---

## R-2: CatalogTemplate preview without dash-card

**Title**: Card container for builder live preview

**Description**: The live CatalogTemplate preview section in the builder renders flush against the other sections with no card boundary, inconsistent with the card-per-section pattern of the rest of the app.

**Current behavior**: Lines 294-310 of CatalogBuilderForm.tsx render `<section aria-label="Live preview">` containing `<h2 className={SECTION_HEADING}>Preview</h2>` and the `<CatalogTemplate>` — both are direct children of the parent card div, creating visual ambiguity.

**Expected behavior**: The preview section is wrapped in a `<div className={CARD}>` (i.e. `rounded-2xl bg-dash-card p-6 shadow-md`) so its background/shadow boundary matches the existing card treatment. The `<h2>` heading remains inside the card; the `SECTION_HEADING` class stays.

**Files affected**:
- `src/modules/catalog-builder/CatalogBuilderForm.tsx` — wrap preview section in CARD div

**Acceptance criteria**:
- Preview section visually renders with `bg-dash-card`, `rounded-2xl`, `p-6`, `shadow-md`
- Preview section spacing is consistent with other sections (gap-6 between cards)
- CatalogTemplate.tsx is NOT modified
- No visual regression to the preview content itself

**Constraints**: Do NOT touch `src/shared/template/CatalogTemplate.tsx`. Only add a wrapper div around the preview section.

---

## R-3: Login lacks client-side validation

**Title**: Client-side validation for login form

**Description**: The login form submits empty username/password to the server, causing a round-trip just to learn "Invalid username or password" — a bad UX that wastes time and shows a misleading error.

**Current behavior**: LoginForm.tsx lines 45-60 have `<input>` elements with no `required` attribute, no `disabled` logic on submit, and no field-level error display on blur. Empty fields submit to `/api/login` and return a generic error after a full network round-trip.

**Expected behavior**: Submit button is disabled when username or password is empty. On blur of an empty field that has been touched, a FIELD_ERROR message appears below the field. Both inputs have `required` attribute. The submit button still shows "Signing in\u2026" during submission.

**Files affected**:
- `src/modules/auth/LoginForm.tsx` — add touched state, blur handlers, field errors, required attr, disabled logic

**Acceptance criteria**:
- Submit button is `disabled` (with `disabled:cursor-not-allowed disabled:opacity-50`) when username or password is empty
- Blurring an empty input after it has been touched shows a `FIELD_ERROR` `<p role="alert">` below it
- Both `<input>` elements have `required` attribute
- Submitting with both fields filled works exactly as before (no regression)
- Validation error messages clear on field change

**Constraints**: No new dependencies. Do not change the server-side `/api/login` route. Do not add a validation library.

---

## R-4: No product search in builder

**Title**: Client-side product name filter in builder

**Description**: The product checklist in the builder can show up to 200 items with no way to filter.

**Current behavior**: Lines 216-228 of CatalogBuilderForm.tsx render `activeCandidates.map(...)` as a flat list of checkboxes with no search/filter mechanism.

**Expected behavior**: An `<input type="search">` is rendered above the product list. As the user types, the list is filtered client-side by product name (case-insensitive `includes` match). The input uses existing `INPUT` styles and includes `placeholder="Search products\u2026"`. The count display at the section heading updates to reflect the filtered count.

**Files affected**:
- `src/modules/catalog-builder/CatalogBuilderForm.tsx` — add search input + filter state + filtered list

**Acceptance criteria**:
- `<input type="search">` appears above the product checklist with `className={INPUT}` and `placeholder="Search products\u2026"`
- Typing in the input filters visible products to those whose `name` contains the query (case-insensitive)
- When filter is active and no products match, show "No products match your search." text
- The `SECTION_HEADING` count updates from "Products (X selected)" to "Products (X selected, Y shown)"
- Filter state resets when `activeCandidates` changes (L1 selection change)

**Constraints**: Filter is client-side only. No API call. No debounce needed.

---

## R-5: Pagination too minimal

**Title**: Numbered page buttons in inventory pagination

**Description**: The inventory pagination renders only "Page X of Y" text with Previous/Next links — no numbered page buttons, making it tedious to jump to a specific page.

**Current behavior**: Lines 111-125 of `src/app/(app)/inventory/page.tsx` render `<nav>` with a text span "Page {page} of {pageCount}", and conditional Previous/Next `<Link>` components only.

**Expected behavior**: Numbered page buttons (1, 2, 3, ..., N) are rendered between the Previous/Next links. The current page button is highlighted with `bg-dash-purple text-dash-fg`. Non-current page buttons are styled as `text-dash-purple hover:underline hover:bg-dash-card`. All navigation uses `<Link>` components. Use `aria-current="page"` on the current page link.

**Files affected**:
- `src/app/(app)/inventory/page.tsx` — replace pagination `<nav>` content

**Acceptance criteria**:
- Numbered buttons show pages 1 through `pageCount`
- Current page button has `bg-dash-purple` background with white text and `aria-current="page"`
- Non-current page buttons are interactive `<Link>` elements
- Previous/Next links are rendered as disabled `<span>` when at boundary
- All navigation uses `<Link>` with search params (no client fetch)
- Pagination works with all current filters preserved in the URL

**Constraints**: Do NOT add client-side state or fetch. Keep Link-based Server Component navigation. Do not add a pagination library.

---

## R-6: No loading skeletons

**Title**: Loading skeleton screens for (app) route group

**Description**: Navigating between pages shows a blank white flash while the server component renders — no visual feedback that content is loading.

**Current behavior**: No `loading.tsx` file exists anywhere in `src/app/`. Pages are server components that stream nothing until fully rendered.

**Expected behavior**: A `src/app/(app)/loading.tsx` file is created that renders pulse-animated skeleton rectangles matching the layout of the most complex page (inventory table: 4-column header row + 5 skeleton rows). Skeleton uses `animate-pulse bg-dash-muted/20 rounded-lg`.

**Files affected**:
- `src/app/(app)/loading.tsx` — new file

**Acceptance criteria**:
- File exists at `src/app/(app)/loading.tsx`
- Renders a `PAGE_HEADING`-sized skeleton bar + a `CARD`-sized skeleton container with a 4-column table header skeleton and 5 row skeletons
- All skeleton elements use `animate-pulse` with `bg-dash-muted/20` and `rounded-lg`
- Skeleton automatically shows during page transitions (Next.js convention)

**Constraints**: Single file only. Do not add loading.tsx to individual route folders. No new dependencies.

---

## R-7: No toast notification system

**Title**: Toast notification context for transient messages

**Description**: Success/error messages (e.g. sync completion, save confirmation, queue errors) appear as inline static text that remains in the DOM until the next interaction — no auto-dismiss, no consistent positioning, no stacking.

**Current behavior**: ManualSyncButton.tsx:110-114 renders a `<p role="status">` inline next to the button. CatalogBuilderForm.tsx:278-285 renders a static `<p>` for queue confirmation. TemplateConfigForm.tsx:156 renders a static inline `<p>` for save confirmation. All are inline, positioned by document flow, not dismissible.

**Expected behavior**: A lightweight Toast context is created in `src/shared/ui/Toast.tsx`: a React context provider, a `useToast()` hook returning `toast.success(msg)` / `toast.error(msg)` / `toast.dismiss(id)`, and a toast container that renders via a React portal at the bottom-right of the viewport. Toasts auto-dismiss after 4 seconds. ManualSyncButton's inline message is replaced with toast calls. Other inline messages are replaced too.

**Files affected**:
- `src/shared/ui/Toast.tsx` — new file (ToastProvider, ToastContainer, useToast hook)
- `src/app/layout.tsx` — wrap children with ToastProvider
- `src/modules/inventory-sync/ManualSyncButton.tsx` — replace inline `<p role="status">` with toast calls
- `src/modules/catalog-builder/CatalogBuilderForm.tsx` — replace queue/error inline messages with toasts
- `src/modules/template-config/TemplateConfigForm.tsx` — replace "Saved." inline message with toast

**Acceptance criteria**:
- Toast container renders in a portal at `fixed bottom-4 right-4 z-50`
- Each toast has `bg-dash-card`, `border-l-4` (green for success, red for error), `shadow-lg`, `rounded-xl`, `p-4`, fade-in transition
- Toast auto-dismisses after 4 seconds
- `ManualSyncButton` shows a toast instead of inline `<p role="status">` on sync completion
- `TemplateConfigForm` shows a toast instead of inline "Saved." text
- `CatalogBuilderForm` shows a toast for queue confirmation and errors
- Multiple toasts stack vertically with `gap-2`

**Constraints**: No new npm dependencies (use React portal + state only). No external toast library.

---

## R-8: No auto-refresh in /catalogs

**Title**: Auto-polling for non-terminal catalog statuses

**Description**: After generating a catalog, the user must manually refresh `/catalogs` to see if the status changed from "Processing" to "Ready" or "Failed".

**Current behavior**: `src/app/(app)/catalogs/page.tsx` is a pure server component with no client-side polling. Rows with terminal uploadStatus show "Processing\u2026" static text.

**Expected behavior**: Add a client-side `useEffect` poll (5-second interval, same pattern as ManualSyncButton's `pollStatus`) that automatically refetches catalog data for rows with non-terminal statuses. Use `window.location.reload()` when all non-terminal rows transition to terminal. Only render the client wrapper when at least one catalog has a non-terminal status.

**Files affected**:
- `src/app/(app)/catalogs/page.tsx` — split into server+client parts, or add a client wrapper component

**Acceptance criteria**:
- When any catalog row has `uploadStatus` in `["pending", "uploading"]`, a 5-second polling interval starts
- When polling detects all non-terminal rows have transitioned to `"uploaded"` or `"failed"`, the page auto-reloads
- When all catalogs are terminal (uploaded/failed), no polling occurs
- Polling stops on component unmount (cleanup in useEffect return)
- No visible UX disruption when the page reloads

**Constraints**: Polling only — no WebSocket, no SSE. Use `window.location.reload()` for simplicity. Reuse ManualSyncButton's polling pattern.

---

## R-9: No animations

**Title**: Transition utilities and subtle motion

**Description**: Interactive elements snap between states with no transition. Status badges are static. Page loads have no fade-in.

**Current behavior**: No CSS transitions on interactive elements. StatusBadge renders a plain `<span>` with no animation. Page content has no entry animation.

**Expected behavior**: Add `transition-colors duration-150` to interactive elements. Add `animate-pulse` to StatusBadge when `status="running"`. Add a fade-in `@keyframes` animation on page `<main>` elements via globals.css.

**Files affected**:
- `src/app/globals.css` — add `@keyframes fadeIn` + `.animate-fadeIn` utility class
- `src/shared/ui/StatusBadge.tsx` — add `animate-pulse` when status is running
- `src/shared/ui/styles.ts` — optionally add FADE_IN constant

**Acceptance criteria**:
- Interactive elements (buttons, links, inputs) have `transition-colors duration-150`
- StatusBadge with `status="running"` has `animate-pulse`
- Page `<main>` elements have a fade-in animation on mount (~300ms)
- No visual regressions — transitions are subtle

**Constraints**: CSS-only. No framer-motion or animation library. No JS-driven animations.

---

## R-10: No focus rings

**Title**: Visible focus-visible ring on all interactive elements

**Description**: Keyboard users navigating the app see no visible focus indicator on buttons, links, inputs, or checkboxes.

**Current behavior**: `globals.css` has no `focus-visible` ring styles. Interactive elements have only `focus:outline-none` in the `INPUT` style (styles.ts:21), which removes the default focus ring without replacing it.

**Expected behavior**: Add `focus-visible:ring-2 focus-visible:ring-dash-purple focus-visible:ring-offset-2 focus-visible:ring-offset-dash-bg` to all interactive elements via a globals.css rule.

**Files affected**:
- `src/app/globals.css` — add focus-visible ring styles targeting `button, a, input, textarea, select, [role="checkbox"], [role="radio"]`

**Acceptance criteria**:
- All `<button>`, `<a>`, `<input>`, `<textarea>`, `<select>` elements show a `#7c3aed` (dash-purple) ring on `focus-visible`
- Ring is `2px` wide with `2px` offset from the background
- `focus:outline-none` can remain on `INPUT` since `focus-visible:ring` replaces the visible indicator
- No change to `:focus` (only `:focus-visible`) — mouse click does not show the ring

**Constraints**: CSS-only. Touch only `globals.css`. Do not touch individual component files for focus rings.

---

## R-11: Template config preview no dash-card

**Title**: Card container for template config preview

**Description**: The template config preview section renders with only a top border, no card background or shadow.

**Current behavior**: Lines 160-177 of TemplateConfigForm.tsx render the preview in a `<section>` with `className="border-t border-dash-border pt-6"` — no `bg-dash-card`, no `rounded-2xl`, no `shadow-md`.

**Expected behavior**: The preview section is wrapped in a `<div className={CARD}>` so it visually matches the card-per-section pattern. The heading stays inside; the wrapping mirrors R-2's treatment of the builder preview.

**Files affected**:
- `src/modules/template-config/TemplateConfigForm.tsx` — wrap preview section in CARD div

**Acceptance criteria**:
- Preview section renders with `bg-dash-card`, `rounded-2xl`, `p-6`, `shadow-md`
- The `<h2 className={SECTION_HEADING}>Preview</h2>` is inside the card
- Content inside the preview is unchanged

**Constraints**: Do NOT touch template config service, API route, or DB schema. CSS-only structural change.

---

## R-12: Logout no loading state

**Title**: Loading state for logout button

**Description**: Clicking the logout icon fires a fetch and immediately navigates — no feedback that the action is in progress.

**Current behavior**: LogoutButton.tsx:17-19 fires `fetch("/api/logout")` and immediately calls `router.push("/login")`. The button has no disabled state, no spinner, no visual feedback.

**Expected behavior**: On click, the button is disabled and shows a `Loader2` spinner from lucide-react (already a dependency). During the fetch, the button has `opacity-50 cursor-not-allowed`. Once the fetch completes, navigation proceeds normally.

**Files affected**:
- `src/modules/layout/LogoutButton.tsx` — add loading state, spinner, disabled styling

**Acceptance criteria**:
- Clicking logout disables the button immediately
- A `Loader2` icon with `animate-spin` replaces the `LogOut` icon during the fetch
- After fetch completes, navigation to `/login` happens
- If fetch fails, button re-enables and error is silently swallowed (match current behavior)
- No change to the server-side `/api/logout` route

**Constraints**: lucide-react is already a dependency — no new packages. Use existing `Loader2` import.

---

## R-13: StatusBadge no icons

**Title**: Status icons in StatusBadge

**Description**: Status badges render as plain colored pills with no icon — the meaning relies entirely on the text label and color, which is less scannable and less accessible.

**Current behavior**: StatusBadge.tsx:24-25 renders `<span className={...}>{label}</span>` — a plain `<span>` with no icon. All badge labels are text-only.

**Expected behavior**: Each status renders a lucide-react icon before the label text:
- `running`/`uploading`: `Loader2` with `animate-spin`
- `completed`/`uploaded`: `Check`
- `failed`: `X`
- `pending`: `Clock`

The icon has `aria-hidden="true"` and is rendered at `size={12}` with a `mr-1` margin. The component API remains unchanged.

**Files affected**:
- `src/shared/ui/StatusBadge.tsx` — add icon imports and icon rendering per status

**Acceptance criteria**:
- `running`/`uploading` badges show a spinning `Loader2` icon
- `completed`/`uploaded` badges show a `Check` icon
- `failed` badges show an `X` icon
- `pending` badges show a `Clock` icon
- All icons have `aria-hidden="true"` and `className="mr-1"`
- StatusBadge component API and className output (`statusBadgeClassName()`) are unchanged
- Label text still renders after the icon

**Constraints**: lucide-react is already a dependency. Do not change the `statusBadgeClassName()` pure function. Do not change CSS classes or color mappings.
