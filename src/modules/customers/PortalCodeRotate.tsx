"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { useToast } from "@/shared/ui/ToastProvider";

const FAILURE = "No se pudo generar el nuevo código.";

/**
 * "Generar nuevo código" (customer-portal WU2): replaces the customer's portal
 * token, so every QR already printed stops working. The warning is the whole
 * point of the dialog, and the request carries an explicit `confirm: true` the
 * server insists on, so a stray POST cannot rotate.
 *
 * The dialog stays OPEN on a failure: the error sits inside it, where the
 * operator is looking, and they can retry or cancel. Same shape as
 * `ConfirmGenerateDialog`.
 */
export function PortalCodeRotate({ clienteId }: { clienteId: string }) {
  const router = useRouter();
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rotate() {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/customers/${clienteId}/portal-token/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (!response.ok) {
        setError(FAILURE);
        return;
      }
    } catch {
      setError(FAILURE);
      return;
    } finally {
      setIsSubmitting(false);
    }

    // BELOW the try/catch, toast above the refresh: see `CustomerActivationButton`.
    setOpen(false);
    addToast("success", "Código del portal renovado");
    router.refresh();
  }

  return (
    <>
      <Button type="button" variant="outline" size="default" className="min-h-11 min-w-11" onClick={() => setOpen(true)}>
        <KeyRound aria-hidden="true" />
        Generar nuevo código
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogTitle>Generar nuevo código</DialogTitle>
          <DialogBody className="space-y-2 text-sm text-muted-foreground">
            <p>
              Al generar un código nuevo, los QR ya impresos dejarán de funcionar. Hay que imprimir de nuevo la copia del
              cliente para que pueda volver a entrar al portal.
            </p>
          </DialogBody>
          {error && (
            <p role="alert" className={`px-6 ${FIELD_ERROR}`}>
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="min-h-11 min-w-11" disabled={isSubmitting} />}>
              Cancelar
            </DialogClose>
            <Button className="min-h-11 min-w-11" onClick={rotate} disabled={isSubmitting}>
              Sí, generar nuevo código
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
