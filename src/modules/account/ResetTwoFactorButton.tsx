"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { useToast } from "@/shared/ui/ToastProvider";

/**
 * "Resetear 2FA" confirmation (login-hardening S5). Controlled, with no trigger:
 * the item lives in the row's ⋮ menu, and a dialog inside that menu unmounts with
 * it (`UsersTable.tsx` explains), so the table mounts this one outside every row.
 */
export function ResetTwoFactorDialog({
  user,
  onClose,
}: {
  user: { id: string; username: string; twoFactorRequired: boolean };
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const { addToast } = useToast();

  async function confirm() {
    setIsSubmitting(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch(`/api/users/${user.id}/two-factor/reset`, { method: "POST" });
    } catch {
      setError(CONNECTION_ERROR);
      setIsSubmitting(false);
      return;
    }
    setIsSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(
        body.error === "self_reset"
          ? "No podés resetear tu propia verificación en dos pasos."
          : "No se pudo resetear la verificación en dos pasos.",
      );
      return;
    }
    // ABOVE the refresh, BELOW the try/catch: a refresh that throws must not hide the confirmation.
    onClose();
    addToast("success", `2FA reseteada para ${user.username}`);
    router.refresh();
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Resetear la verificación en dos pasos de {user.username}?</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <p>
            Se borran su app y sus códigos de recuperación, y se cierran sus sesiones.{" "}
            {user.twoFactorRequired
              ? "La próxima vez que entre la va a tener que configurar de nuevo."
              : "Va a poder activarla de nuevo desde Mi cuenta."}
          </p>
          {error && (
            <p role="alert" className={FIELD_ERROR}>
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" disabled={isSubmitting} />}>Cancelar</DialogClose>
          <Button type="button" variant="destructive" disabled={isSubmitting} onClick={confirm}>
            {isSubmitting ? "Reseteando…" : "Sí, resetear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
