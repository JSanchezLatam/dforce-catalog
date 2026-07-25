"use client";

import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogPopup, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import { LazyImage } from "@/shared/ui/LazyImage";

export function ImagePreviewDialog({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPopup>
          <div className="relative max-h-[85vh] max-w-[85vw] rounded-xl bg-background shadow-2xl overflow-hidden">
            <DialogClose
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
            </DialogClose>
            <LazyImage src={src} alt={alt} className="max-h-[85vh] max-w-[85vw] min-h-[200px] min-w-[200px]" />
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
