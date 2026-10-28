"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

/** Controlled and non-modal: the parent owns `open`, and the page behind stays interactive. */
function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

/**
 * The portal mounts only while open (Base UI's default), with no `typeof document` gate: that gate is the
 * hydration mismatch this repo already paid for. `anchor` is the element to place against, so a popover can
 * open from a card that is not a trigger.
 */
function PopoverContent({
  className,
  anchor,
  side = "right",
  align = "start",
  sideOffset = 8,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "anchor" | "side" | "align" | "sideOffset">) {
  return (
    <PopoverPrimitive.Portal data-slot="popover-portal">
      <PopoverPrimitive.Positioner anchor={anchor} side={side} align={align} sideOffset={sideOffset} className="z-50">
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "w-[340px] max-w-[calc(100vw-1rem)] rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg outline-hidden",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverContent }
