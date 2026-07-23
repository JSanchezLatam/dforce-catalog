"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LazyImage } from "@/shared/ui/LazyImage";

export function ImagePreviewDialog({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/80 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-hidden">
          <div className="relative max-h-[85vh] max-w-[85vw] rounded-xl bg-background shadow-2xl overflow-hidden">
            <DialogPrimitive.Close
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-2 right-2 z-10 bg-background/80 backdrop-blur-xs"
                />
              }
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
            <LazyImage src={src} alt={alt} className="max-h-[85vh] max-w-[85vw] min-h-[200px] min-w-[200px]" />
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
