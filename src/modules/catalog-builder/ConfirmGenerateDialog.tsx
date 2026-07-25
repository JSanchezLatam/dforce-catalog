"use client";

import { AlertTriangleIcon, LoaderIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        {hasWarning && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <p>
              Ya tienes {catalogCount} catálogos guardados. El más antiguo se eliminará
              automáticamente cuando este esté listo.
            </p>
          </div>
        )}

        <DialogTitle>Confirmar generación</DialogTitle>

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

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={isSubmitting} />}>
            Cancelar
          </DialogClose>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
