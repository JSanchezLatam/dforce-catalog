"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { CustomerQuickForm } from "@/modules/agenda/CustomerQuickForm";
import type { PublicVehiculo } from "@/modules/customers/vehicles";
import { CATEGORIA_LABEL, type ServiceCategory } from "@/modules/service-orders/categories";
import { CustomerPicker } from "@/modules/service-orders/CustomerPicker";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { useToast } from "@/shared/ui/ToastProvider";

/**
 * `canCreateCustomer` defaults to true: `/agenda` is gated by `agenda.manage`, which only roles that also hold
 * `customers.write` have (policy.ts), and the server answers 403 regardless. Plumb it from the page if that changes.
 *
 * "Nueva cita": a `booked` order (customer, moment, description; optional vehicle and category; never a
 * technician). The CALLER owns `open` (the shell, from the header or an empty slot) and passes the prefill as `day` and
 * `time`. The body mounts only while open, so every opening starts from a clean form. The moment is built from two
 * strings with the explicit Panama offset, so the browser's zone never enters.
 */
export function AgendaBookingForm({ open, onOpenChange, day, time = "", canCreateCustomer = true }: { open: boolean; onOpenChange: (open: boolean) => void; day: string; time?: string; canCreateCustomer?: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva cita</DialogTitle>
        </DialogHeader>
        <BookingFields initialDay={day} initialTime={time} canCreateCustomer={canCreateCustomer} onBooked={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** The per-day "+" control of the month cells (until the month view opens the shell's dialog): 44px, named by its day. */
export function DayBooking({ day }: { day: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" className="min-h-11 min-w-11" aria-label={`Agendar cita el ${day.slice(8)}/${day.slice(5, 7)}`} onClick={() => setOpen(true)}>+</Button>
      <AgendaBookingForm open={open} onOpenChange={setOpen} day={day} />
    </>
  );
}

/** Server refusals worth their own Spanish line; anything else shows the route's own `errors` text. */
function refusal(status: number, body: { error?: string; errors?: Record<string, string> } | null): string {
  if (body?.error === "cliente_deactivated") return "Ese cliente está desactivado. Elegí otro.";
  if (body?.error === "unknown_cliente") return "Seleccioná un cliente válido";
  return Object.values(body?.errors ?? {})[0] ?? (status === 403 ? "No tenés permiso para agendar citas." : "No se pudo agendar la cita. Intentalo de nuevo.");
}

type VehicleChoice = Pick<PublicVehiculo, "id" | "plate" | "make" | "model">;
const choiceLabel = (v: VehicleChoice) => [v.plate, [v.make, v.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
const CHIP = "agenda-ev min-h-11 rounded-full px-3 text-xs font-semibold";

function BookingFields({ initialDay, initialTime, canCreateCustomer, onBooked }: { initialDay: string; initialTime: string; canCreateCustomer: boolean; onBooked: () => void }) {
  const router = useRouter();
  const { addToast } = useToast();
  const id = useId();
  const formId = `${id}-form`;
  const [clienteId, setClienteId] = useState("");
  const [day, setDay] = useState(initialDay);
  const [time, setTime] = useState(initialTime);
  const [vehiculoId, setVehiculoId] = useState("");
  const [categoria, setCategoria] = useState<ServiceCategory | null>(null);
  // Keyed by the customer it answers for, so a slow response for a customer no longer selected never paints.
  const [fetched, setFetched] = useState<{ key: string; vehicles: VehicleChoice[]; failed: boolean }>({ key: "", vehicles: [], failed: false });
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Set by callback ref once mounted, so the portal below never renders on the server.
  const [quickSlot, setQuickSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!clienteId) return;
    let cancelled = false;
    fetch(`/api/customers/${clienteId}/vehicles`)
      .then((response) => {
        // An HTTP error is an error: folding it into an empty list tells the customer with three cars to add one.
        if (!response.ok) throw new Error(`vehicles fetch failed: ${response.status}`);
        return response.json();
      })
      .then((body: { vehicles: VehicleChoice[] }) => !cancelled && setFetched({ key: clienteId, vehicles: body.vehicles, failed: false }))
      .catch(() => !cancelled && setFetched({ key: clienteId, vehicles: [], failed: true }));
    return () => {
      cancelled = true;
    };
  }, [clienteId]);
  const settled = Boolean(clienteId) && fetched.key === clienteId;

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
        body: JSON.stringify({
          clienteId,
          status: "booked",
          appointmentAt: `${day}T${time}:00-05:00`,
          description: description.trim() || null,
          ...(vehiculoId && { vehiculoId }),
          ...(categoria && { categoria }),
        }),
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
    <>
    <form id={formId} onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
      <DialogBody className="flex flex-col gap-4">
        <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          <Label>Cliente</Label>
          <CustomerPicker selectedCustomer={null} canCreateCustomer={canCreateCustomer}
            onSelect={(c) => {
              setClienteId(c.id);
              setVehiculoId("");
            }}
            onDeselect={() => setClienteId("")}
            // Portalled to a sibling of the booking <form>: a <form> inside a <form> is invalid DOM.
            renderCreate={(select) => quickSlot && createPortal(<CustomerQuickForm canWrite={canCreateCustomer} onSaved={select} />, quickSlot)}
          />
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
        {clienteId && settled ? (
          <div role="group" aria-label="Vehículo" className="grid gap-2">
            <Label>Vehículo (opcional)</Label>
            {fetched.failed ? (
              <p className="text-sm text-muted-foreground">No se pudieron cargar los vehículos</p>
            ) : fetched.vehicles.length === 0 ? (
              <p className="text-sm text-muted-foreground">Este cliente no tiene vehículos</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {fetched.vehicles.map((v) => (
                  <Button key={v.id} type="button" variant="outline" aria-pressed={vehiculoId === v.id} className={cn("min-h-11 text-xs", vehiculoId === v.id && "border-foreground font-semibold")} onClick={() => setVehiculoId(vehiculoId === v.id ? "" : v.id)}>
                    {choiceLabel(v)}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ) : null}
        <div role="group" aria-label="Categoría" className="grid gap-2">
          <Label>Categoría (opcional)</Label>
          <div className="flex flex-wrap gap-1.5">
            {(Object.entries(CATEGORIA_LABEL) as [ServiceCategory, string][]).map(([key, label]) => (
              <button key={key} type="button" data-categoria={key} aria-pressed={categoria === key} onClick={() => setCategoria(categoria === key ? null : key)} className={`${CHIP} ${categoria === key ? "ring-2 ring-foreground" : "opacity-60"}`}>
                {label}
              </button>
            ))}
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
    </form>
    {/* Fields, then the quick customer form, then the footer. The footer sits outside the <form> (the
        submit points back at it with `form`) so the quick form can sit between them as a sibling. */}
    <div ref={setQuickSlot} className="shrink-0" />
    <DialogFooter>
      <DialogClose render={<Button type="button" variant="outline" disabled={isSubmitting} />}>Cancelar</DialogClose>
      <Button type="submit" form={formId} disabled={isSubmitting}>
        {isSubmitting ? "Guardando…" : "Agendar cita"}
      </Button>
    </DialogFooter>
    </>
  );
}
