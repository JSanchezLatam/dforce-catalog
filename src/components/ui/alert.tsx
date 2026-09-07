import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * A block-level message box: an icon in the gutter, the message beside it.
 *
 * `destructive` deliberately reuses the exact triple the "Desactivado" chip on
 * the customer list already renders (`border-destructive/40 bg-destructive/10
 * text-destructive`) rather than inventing a second red. One red vocabulary in
 * the app means a bordered red box always reads as the same severity.
 *
 * FORM- and BLOCK-level only. A validation message under one input stays plain
 * red text (`FIELD_ERROR`): boxing every field error makes a six-field form
 * shout, and the box stops meaning anything the moment three of them stack.
 */
const alertVariants = cva(
  "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&>svg:first-child]:mt-0.5",
  {
    variants: {
      variant: {
        default: "border-border bg-muted text-muted-foreground",
        destructive: "border-destructive/40 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

/**
 * No `role` of its own. Every caller in this repo already declares whether its
 * message is an `alert` (a failure being announced) or a `status` (state that
 * was there on load) — baking one in here would silently promote or demote
 * theirs.
 */
function Alert({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Alert, alertVariants }
