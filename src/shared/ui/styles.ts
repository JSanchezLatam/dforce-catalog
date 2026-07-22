/**
 * PR5 — small reusable set of Tailwind class strings, remapped in PR7 from
 * the rejected Kanagawa Dragon theme to the confirmed dash-* v2 redesign
 * palette (design.md's confirmed OpenPencil "dashboard v2" mockups) —
 * applied to the pre-existing plain HTML page content
 * (login/inventory/builder/catalogs/template-config).
 *
 * PR7 also bumps corner radius to match the v2 mockups' rounder,
 * "premium dashboard" look: cards → rounded-2xl, buttons/inputs → rounded-lg.
 *
 * ponytail: flat string constants only, no variant/size props or a component
 * library — extend this file (not bespoke per-page strings) if a genuinely
 * new visual treatment is needed; only introduce real components if a 4th+
 * distinct treatment shows up.
 */
export const CARD = "rounded-2xl bg-dash-card p-6 shadow-md";
export const PAGE_HEADING = "mb-6 text-[32px] font-bold text-dash-fg";
export const SECTION_HEADING = "mb-3 text-lg font-semibold text-dash-fg";
export const LABEL = "mb-1 block text-sm font-medium text-dash-fg";
export const INPUT =
  "w-full rounded-lg border border-dash-border bg-dash-bg px-3 py-2 text-sm text-dash-fg focus:border-dash-purple focus:outline-none";
export const PRIMARY_BUTTON =
  "rounded-lg bg-dash-purple px-4 py-2 text-sm font-medium text-dash-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
export const TABLE_TH = "px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-dash-muted";
export const TABLE_TD = "px-4 py-2 text-sm text-dash-fg";
export const FIELD_ERROR = "text-sm text-dash-red";
