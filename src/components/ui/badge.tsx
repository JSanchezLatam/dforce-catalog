import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        /**
         * The text colour is deliberately NOT `text-destructive`, and the
         * numbers are in `badge.test.tsx`: dark's `--destructive`
         * (hsl(0 62.8% 30.6%)) is a near-maroon built to be a BACKGROUND, so
         * using it as a foreground on its own 20% tint measures 1.80:1 — the
         * "0 en stock" chip the owner could not read. Light was no better at
         * 3.30:1; it just failed quietly. `text-red-700` / `dark:text-red-400`
         * measure 5.64:1 and 6.24:1 on the same grounds, clearing AA's 4.5:1.
         *
         * The tinted ground stays: every alternative that keeps `--destructive`
         * as the text or as a solid ground still fails light (white on
         * hsl(0 84.2% 60.2%) is 3.60:1). Raw palette reds are already this
         * repo's practice where a token does not reach — see
         * `service-orders/[id]/print/page.tsx:36`.
         *
         * `Button`/`Alert`'s destructive variants and the hand-rolled
         * "Desactivado" chip (`customers/page.tsx:285`) still carry the old
         * triple and measure the same. That is the `--destructive` token, not
         * this variant, and it is a follow-up rather than silent scope here.
         */
        destructive:
          "bg-destructive/10 text-red-700 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:text-red-400 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
