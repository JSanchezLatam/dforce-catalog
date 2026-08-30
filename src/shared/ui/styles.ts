/**
 * Minimal Tailwind class constants for common page-level patterns not
 * covered by shadcn/ui components. All component-layer styles now use
 * shadcn/ui components directly (Card, Table, Input, Button, Label, etc.)
 */
export const PAGE_HEADING = "mb-6 text-[32px] font-bold text-foreground";
export const SECTION_HEADING = "mb-3 text-lg font-semibold text-foreground";
export const CARD = "rounded-xl border bg-card p-4 text-card-foreground";
/**
 * `CARD`'s deactivated twin: the same border and radius, a deliberately
 * secondary surface and foreground. A separate constant rather than
 * `CARD + " bg-muted"` because two utilities on the same property are ordered
 * by the generated stylesheet, not by the class attribute — appending would
 * leave which one wins up to Tailwind's output order. Tighter padding too: a
 * vehicle that is out of service is a one-line row, not a card.
 */
export const CARD_MUTED = "rounded-xl border bg-muted p-3 text-muted-foreground";
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
/**
 * The same plate on a DEACTIVATED vehicle — thin border, normal weight, muted
 * ink. The plate is the workshop's lookup key, so it stays scannable, but a
 * vehicle that is out of service must not compete with one that is in it:
 * "which of these can I work on" is answered by weight, never by reading a
 * caption next to an identical badge.
 */
export const PLATE_BADGE_MUTED =
  "inline-flex items-center rounded-md border border-border bg-muted px-2 py-1 font-mono text-sm font-medium tracking-wider text-muted-foreground";
/** A small pill for a single vehicle attribute (year, make, model) — reads better than a label/value grid at this field count. */
export const CHIP =
  "inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground";
