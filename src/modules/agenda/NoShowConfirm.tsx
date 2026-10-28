"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { AgendaItem } from "@/modules/agenda/items";
import { patchOrder } from "@/modules/agenda/patchOrder";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { useToast } from "@/shared/ui/ToastProvider";

/** "No se presentó": offered to a Vencida booked appointment only; an ordinary cancellation behind a confirmation. */
export function NoShowConfirm({ item, onSuccess }: { item: AgendaItem; onSuccess?: () => void }) {
  const [open, setOpen] = useState(false);
  if (item.muted || !item.overdue) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" className="min-h-11 min-w-11" />}>No se presentó</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿El cliente no se presentó?</DialogTitle>
        </DialogHeader>
        <ConfirmBody item={item} onDone={() => setOpen(false)} onSuccess={onSuccess} />
      </DialogContent>
    </Dialog>
  );
}

function ConfirmBody({ item, onDone, onSuccess }: { item: AgendaItem; onDone: () => void; onSuccess?: () => void }) {
  const router = useRouter();
  const { addToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function confirm() {
    setIsSubmitting(true);
    setError(null);
    // `expectedStatus` makes a stale screen refuse (409) instead of cancelling an order received meanwhile.
    const failure = await patchOrder(item.id, { status: "cancelled", expectedStatus: "booked" });
    setIsSubmitting(false);
    if (failure) {
      setError(failure);
      return;
    }
    // ABOVE the refresh, BELOW the try/catch (inside patchOrder).
    onDone();
    onSuccess?.();
    addToast("success", "Orden cancelada");
    router.refresh();
  }

  return (
    <>
      <DialogBody className="flex flex-col gap-4">
        <p>La orden de {item.customerName} se cancelará. Esta acción no se puede deshacer.</p>
        {error && (
          <p role="alert" className={FIELD_ERROR}>
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" disabled={isSubmitting} />}>Volver</DialogClose>
        <Button type="button" variant="destructive" disabled={isSubmitting} onClick={confirm}>
          {isSubmitting ? "Cancelando…" : "Cancelar la orden"}
        </Button>
      </DialogFooter>
    </>
  );
}
