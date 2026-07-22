/**
 * PR5 — small reusable set of Tailwind class strings (Kanagawa Dragon theme,
 * design.md's confirmed OpenPencil mockups) applied to the pre-existing plain
 * HTML page content (login/inventory/builder/catalogs/template-config) that
 * PR1-4 never touched — those PRs only styled the NEW sidebar shell + status
 * badge, not this older content.
 *
 * ponytail: flat string constants only, no variant/size props or a component
 * library — extend this file (not bespoke per-page strings) if a genuinely
 * new visual treatment is needed; only introduce real components if a 4th+
 * distinct treatment shows up.
 */
export const CARD = "rounded-lg bg-dragon-sidebar-bg p-6 shadow-md";
export const PAGE_HEADING = "mb-6 text-[32px] font-bold text-dragon-fg";
export const SECTION_HEADING = "mb-3 text-lg font-semibold text-dragon-fg";
export const LABEL = "mb-1 block text-sm font-medium text-dragon-fg";
export const INPUT =
  "w-full rounded border border-dragon-muted bg-dragon-bg px-3 py-2 text-sm text-dragon-fg focus:border-dragon-blue focus:outline-none";
export const PRIMARY_BUTTON =
  "rounded bg-dragon-blue px-4 py-2 text-sm font-medium text-dragon-sidebar-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
export const TABLE_TH = "px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-dragon-muted";
export const TABLE_TD = "px-4 py-2 text-sm text-dragon-fg";
export const FIELD_ERROR = "text-sm text-dragon-red";
