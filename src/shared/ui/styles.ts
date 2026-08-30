/**
 * Minimal Tailwind class constants for common page-level patterns not
 * covered by shadcn/ui components. All component-layer styles now use
 * shadcn/ui components directly (Card, Table, Input, Button, Label, etc.)
 */
export const PAGE_HEADING = "mb-6 text-[32px] font-bold text-foreground";
export const SECTION_HEADING = "mb-3 text-lg font-semibold text-foreground";
export const CARD = "rounded-xl border bg-card p-4 text-card-foreground";
export const FIELD_ERROR = "text-sm text-destructive";
/**
 * A license plate rendered as a plate, not plain text — bordered, monospace,
 * visually distinct from surrounding copy. Used on the vehicle card/row
 * wherever a plate is the primary identifier (`CustomerForm`, the customer
 * detail view) — it is the workshop's lookup key, so it is deliberately the
 * most scannable thing on the card.
 */
export const PLATE_BADGE =
  "inline-flex items-center rounded-md border-2 border-foreground/60 bg-muted px-2 py-1 font-mono text-sm font-bold tracking-wider text-foreground";
/** A small pill for a single vehicle attribute (year, make, model) — reads better than a label/value grid at this field count. */
export const CHIP =
  "inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground";
