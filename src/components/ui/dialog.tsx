"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/80 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * Low-level positioning layer: a fixed, centered flex wrapper around the
 * dialog surface. Use this directly (instead of `DialogContent`) when a
 * call site needs full control over the visual box (e.g. an image preview
 * with no padding/flex-col chrome).
 */
function DialogPopup({ className, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Popup
      data-slot="dialog-popup"
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center p-4 outline-hidden",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPopup>
        <div
          data-slot="dialog-content"
          className={cn(
            "relative flex max-h-[85vh] w-full max-w-lg flex-col gap-5 rounded-xl bg-background p-6 shadow-2xl",
            className
          )}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-3 right-3"
                />
              }
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          )}
        </div>
      </DialogPopup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("shrink-0 flex flex-col gap-1.5 text-center sm:text-left", className)}
      {...props}
    />
  )
}

/**
 * The scrolling middle of a dialog. `DialogContent` caps height at `85vh` but
 * nothing inside it scrolled, so a dialog taller than the cap — the customer
 * edit form with several vehicles, on any short viewport — rendered its
 * overflow OUTSIDE the surface, floating over the page behind it. The cap was
 * right; the missing scroll container was the bug.
 *
 * It lives here rather than in one form because the cap lives here: EVERY
 * `DialogContent` inherits `85vh`, so every long dialog has the same defect.
 * It is opt-in rather than automatic because a call site — not this component
 * — knows which of its children is the body: three of the four forms nest
 * `DialogFooter` INSIDE their `<form>`, so a scroll box wrapped blindly around
 * `DialogContent`'s children would take Guardar with it.
 *
 * `min-h-0` is load-bearing: a flex item's default `min-height: auto` refuses
 * to shrink below its content, which leaves the cap in force and the overflow
 * silently unscrollable. `-mx-1 px-1` is a net-zero visual offset that keeps a
 * focus ring on an edge input from being clipped by the scroll box.
 *
 * The direct parent must be a `flex flex-col` box with a bounded height —
 * `DialogContent` itself, or a `<form>` carrying `min-h-0 flex-1`.
 */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("-mx-1 min-h-0 flex-1 overflow-y-auto px-1", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading text-lg font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogPopup,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
