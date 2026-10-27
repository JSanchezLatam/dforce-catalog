"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomerPicker } from "@/modules/service-orders/CustomerPicker";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { useToast } from "@/shared/ui/ToastProvider";

/**
 * "Agendar cita": a slim `booked` order (customer, moment, description; no vehicle, category or
 * technician). Each trigger owns its own controlled Dialog and the body mounts only while open, so a
 * month of cells costs one button each and every opening starts from a clean form. The moment is
 * built from two strings with the explicit Panama offset, so the browser's zone never enters.
 */
export function AgendaBookingForm({ day, triggerLabel = "Agendar cita", triggerClassName, ariaLabel }: { day: string; triggerLabel?: string; triggerClassName?: string; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant={triggerClassName ? "ghost" : "default"} className={triggerClassName} aria-label={ariaLabel} />}>{triggerLabel}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agendar cita</DialogTitle>
        </DialogHeader>
        <BookingFields initialDay={day} onBooked={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** The per-day "+" control of the views: 44px, named by its day so the cells stay distinguishable. */
export function DayBooking({ day }: { day: string }) {
  return <AgendaBookingForm day={day} triggerLabel="+" ariaLabel={`Agendar cita el ${day.slice(8)}/${day.slice(5, 7)}`} triggerClassName="min-h-11 min-w-11" />;
}

/** Server refusals worth their own Spanish line; anything else shows the route's own `errors` text. */
function refusal(status: number, body: { error?: string; errors?: Record<string, string> } | null): string {
  if (body?.error === "cliente_deactivated") return "Ese cliente está desactivado. Elegí otro.";
  if (body?.error === "unknown_cliente") return "Seleccioná un cliente válido";
  return Object.values(body?.errors ?? {})[0] ?? (status === 403 ? "No tenés permiso para agendar citas." : "No se pudo agendar la cita. Intentalo de nuevo.");
}

function BookingFields({ initialDay, onBooked }: { initialDay: string; onBooked: () => void }) {
  const router = useRouter();
  const { addToast } = useToast();
  const id = useId();
  const [clienteId, setClienteId] = useState("");
  const [day, setDay] = useState(initialDay);
  const [time, setTime] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missing = !clienteId ? "Elegí un cliente" : !day ? "Elegí el día" : !time ? "Elegí la hora" : null;
    if (missing) {
      setError(missing);
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/service-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, status: "booked", appointmentAt: `${day}T${time}:00-05:00`, description: description.trim() || null }),
      });
      if (!response.ok) {
        setError(refusal(response.status, await response.json().catch(() => null)));
        return;
      }
    } catch {
      // `router.refresh()` sits BELOW, not inside: a refresh that throws must not read as a connection failure.
      setError(CONNECTION_ERROR);
      return;
    } finally {
      setIsSubmitting(false);
    }

    // ABOVE the refresh, BELOW the try/catch: a refresh that throws must not retract the only
    // confirmation of a booking the server accepted.
    onBooked();
    addToast("success", "Cita agendada");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
      <DialogBody className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label>Cliente</Label>
          <CustomerPicker selectedCustomer={null} canCreateCustomer={false} onSelect={(c) => setClienteId(c.id)} onDeselect={() => setClienteId("")} />
        </div>
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
        <div className="grid gap-2">
          <Label htmlFor={`${id}-description`}>Descripción</Label>
          <Input id={`${id}-description`} value={description} onChange={(e) => setDescription(e.target.value)} />
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
          {isSubmitting ? "Guardando…" : "Guardar cita"}
        </Button>
      </DialogFooter>
    </form>
  );
}
