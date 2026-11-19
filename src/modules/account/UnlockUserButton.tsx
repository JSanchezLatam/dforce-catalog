"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { useToast } from "@/shared/ui/ToastProvider";

/** "Desbloquear": shown on a locked row only, behind a confirmation (login-hardening S6). */
export function UnlockUserButton({ user }: { user: { id: string; username: string } }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const { addToast } = useToast();

  async function confirm() {
    setIsSubmitting(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch(`/api/users/${user.id}/unlock`, { method: "POST" });
    } catch {
      setError(CONNECTION_ERROR);
      setIsSubmitting(false);
      return;
    }
    setIsSubmitting(false);
    if (!res.ok) {
      setError("No se pudo desbloquear al usuario.");
      return;
    }
    // ABOVE the refresh, BELOW the try/catch: a refresh that throws must not hide the confirmation.
    setOpen(false);
    addToast("success", "Usuario desbloqueado");
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      {/* The mockup's light button: a white action the eye reads as a button on the graphite ground. */}
      <DialogTrigger render={<Button type="button" size="sm" className="bg-foreground text-background hover:bg-foreground/90" />}>
        Desbloquear
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Desbloquear a {user.username}?</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <p>Va a poder volver a intentar entrar ahora, sin esperar a que termine el bloqueo.</p>
          {error && (
            <p role="alert" className={FIELD_ERROR}>
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" disabled={isSubmitting} />}>Cancelar</DialogClose>
          <Button type="button" disabled={isSubmitting} onClick={confirm}>
            {isSubmitting ? "Desbloqueando…" : "Sí, desbloquear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
