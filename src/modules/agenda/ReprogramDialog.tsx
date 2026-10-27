"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AgendaItem } from "@/modules/agenda/items";
import { patchOrder } from "@/modules/agenda/patchOrder";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { useToast } from "@/shared/ui/ToastProvider";

/** "Reprogramar": a booked appointment (Vencida or not) moves to a new Panama day and time. Muted chips get nothing. */
export function ReprogramDialog({ item, onSuccess }: { item: AgendaItem; onSuccess?: () => void }) {
  const [open, setOpen] = useState(false);
  if (item.muted) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" className="min-h-11 min-w-11" />}>Reprogramar</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reprogramar cita</DialogTitle>
        </DialogHeader>
        <ReprogramFields item={item} onDone={() => setOpen(false)} onSuccess={onSuccess} />
      </DialogContent>
    </Dialog>
  );
}

function ReprogramFields({ item, onDone, onSuccess }: { item: AgendaItem; onDone: () => void; onSuccess?: () => void }) {
  const router = useRouter();
  const { addToast } = useToast();
  const id = useId();
  const [day, setDay] = useState(item.dayKey);
  const [time, setTime] = useState(item.time);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missing = !day ? "Elegí el día" : !time ? "Elegí la hora" : null;
    if (missing) {
      setError(missing);
      return;
    }
    setIsSubmitting(true);
    setError(null);
    // Built from two strings with the explicit Panama offset: the browser's zone never enters.
    const failure = await patchOrder(item.id, { appointmentAt: `${day}T${time}:00-05:00`, expectedStatus: "booked" });
    setIsSubmitting(false);
    if (failure) {
      setError(failure);
      return;
    }
    // ABOVE the refresh, BELOW the try/catch (inside patchOrder).
    onDone();
    onSuccess?.();
    addToast("success", "Cita reprogramada");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
      <DialogBody className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-day`}>Día</Label>
            <Input id={`${id}-day`} type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-time`}>Hora</Label>
            <Input id={`${id}-time`} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        {error && (
          <p role="alert" className={FIELD_ERROR}>
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" disabled={isSubmitting} />}>Cancelar</DialogClose>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : "Guardar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
