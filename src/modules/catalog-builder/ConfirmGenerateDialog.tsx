"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { AlertTriangleIcon, LoaderIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CategoryRef } from "./selection";

export function ConfirmGenerateDialog({
  open,
  onOpenChange,
  categories,
  title,
  productCount,
  catalogCount,
  isSubmitting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: CategoryRef[];
  title: string;
  productCount: number;
  catalogCount: number;
  isSubmitting: boolean;
  onConfirm: () => void;
}) {
  const hasWarning = catalogCount >= 2;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/80 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-hidden">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col gap-5 rounded-xl bg-background p-6 shadow-2xl">
            {hasWarning && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                <p>
                  Ya tienes {catalogCount} catálogos guardados. El más antiguo se eliminará
                  automáticamente cuando este esté listo.
                </p>
              </div>
            )}

            <DialogPrimitive.Title className="text-lg font-semibold text-foreground">
              Confirmar generación
            </DialogPrimitive.Title>

            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Se generará un catálogo con <strong>{productCount} productos</strong> en las
                siguientes categorías:
              </p>
              <ul className="ml-4 list-disc space-y-1">
                {categories.map((cat) => (
                  <li key={`${cat.categoryL1}::${cat.categoryL2 ?? ""}`}>
                    <span className="font-medium text-foreground">{cat.categoryL1}</span>
                    {cat.categoryL2 && <span> &rarr; {cat.categoryL2}</span>}
                  </li>
                ))}
              </ul>
              <p className="pt-1">
                Título: <span className="font-medium text-foreground">{title}</span>
              </p>
            </div>

            <div className="flex justify-end gap-3">
              <DialogPrimitive.Close render={<Button variant="outline" disabled={isSubmitting} />}>
                Cancelar
              </DialogPrimitive.Close>
              <Button onClick={onConfirm} disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <LoaderIcon className="mr-1.5 size-4 animate-spin" />
                    Generando...
                  </>
                ) : (
                  "Generar catálogo"
                )}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
