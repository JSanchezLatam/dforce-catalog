"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { FIELD_ERROR } from "@/shared/ui/styles";

/**
 * D4 — adds ONE vehicle to an already-chosen customer, from inside the
 * order-creation dialog. Four fields: placa, marca, modelo, año.
 *
 * **This is deliberately NOT `CustomerForm`, and it must not become it.**
 * `ClienteListItem` (`customers/queries.ts`) is a `Pick` that does not carry
 * `whatsappOptOut` or `emailOptOut`, while `CustomerForm.buildPayload` always
 * resends both from form state — so pre-seeding `CustomerForm` from the
 * picker's data and saving writes the form's DEFAULTS over the customer's
 * real opt-outs. There is no `GET /api/customers/[id]` to read the true
 * values from either. AGENTS.md names exactly this: the two booleans are
 * "legally distinct consent regimes, never collapse them."
 *
 * The mitigation is structural, not procedural. A form with no consent field,
 * posting to a route (`POST /api/customers/[id]/vehicles`) whose handler
 * cannot address a `cliente` column at all, CANNOT reset consent — the trap
 * is unreachable rather than merely unused. `VehicleQuickForm.test.tsx`'s
 * "sends only plate, make, model and year" is what says so on every commit.
 *
 * A Dialog rather than an inline block on purpose: this renders inside
 * `ServiceOrderForm`'s `<form>`, and a nested `<form>` element is invalid
 * HTML. The Dialog portals out of it — the same reason `CustomerForm` already
 * nests safely inside `CustomerPicker` inside that same form (D5: the nesting
 * is not the trap).
 */
export function VehicleQuickForm({
  clienteId,
  onCreated,
}: {
  clienteId: string;
  onCreated: (vehiculoId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setPlate("");
      setMake("");
      setModel("");
      setYear("");
      setErrors({});
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Not decoration. A Dialog portals out of the DOM, but React propagates
    // events along the REACT tree, not the DOM one — so this submit reaches
    // `ServiceOrderForm`'s `<form onSubmit>` ancestor and creates the ORDER
    // while the operator is still adding a vehicle to it. Measured, not
    // assumed: without this line "selects the vehicle it just created" fails
    // with the whole order dialog gone from the document.
    event.stopPropagation();
    setIsSubmitting(true);
    setErrors({});
    let createdId: string;

    try {
      const response = await fetch(`/api/customers/${clienteId}/vehicles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Four keys, and blank ones omitted rather than sent as "" — matching
        // `validation.ts`'s `trimmedOrUndefined`. `year` is coerced with
        // `Number()` (D10, the same coercion `CustomerForm.buildPayload`
        // already does): the validator keeps `year` only when it is ALREADY a
        // number, so a raw `"2019"` from this `type="number"` input would be
        // dropped on the floor — and the route now answers 400 rather than
        // saving a yearless row, so the coercion is load-bearing on both ends.
        body: JSON.stringify({
          plate: plate.trim(),
          make: make.trim() || undefined,
          model: model.trim() || undefined,
          year: year.trim() ? Number(year) : undefined,
        }),
      });

      // 400 is the only status that carries an `errors` MAP (per-field, from
      // `validateVehiculoInput`). 404 and 409 carry a single `error` STRING,
      // so `body.errors` is undefined for both and they would fall through to
      // the generic copy. That matters most for the 409: it is DETERMINISTIC,
      // and "Intentalo de nuevo" sends the operator round a loop that returns
      // the identical refusal forever. Same guard, same reason, as
      // `ServiceOrderForm`'s 409 branch and `CustomerForm`'s shared-phone one.
      if (response.status === 400) {
        const body = await response.json();
        setErrors(body.errors ?? { form: "No se pudo agregar el vehículo." });
        return;
      }
      if (response.status === 404 || response.status === 409) {
        // Reachable through the stale-tab race the server guard exists for:
        // staff A opens this dialog on Juan, staff B deactivates Juan, staff A
        // saves the vehicle.
        const body = await response.json();
        setErrors({
          form:
            body.error === "cliente_deactivated"
              ? "Este cliente fue desactivado. Reactivalo para poder agregarle un vehículo."
              : "No se pudo agregar el vehículo.",
        });
        return;
      }
      if (!response.ok) {
        setErrors({ form: "No se pudo agregar el vehículo. Intentalo de nuevo." });
        return;
      }

      const body = await response.json();
      createdId = body.vehiculo.id;
    } catch {
      // `fetch` REJECTS on a network failure instead of returning a non-ok
      // response; without this the dialog re-enables with nothing on screen.
      // Same catch, same copy as `CustomerForm` and `ServiceOrderForm`.
      setErrors({ form: CONNECTION_ERROR });
      return;
    } finally {
      setIsSubmitting(false);
    }

    setOpen(false);
    onCreated(createdId);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* AGENTS.md's 44x44 floor: `size="default"` is `h-8` = 32px. */}
      <DialogTrigger render={<Button type="button" variant="outline" className="min-h-11 min-w-11" />}>
        Agregar vehículo
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar vehículo</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="vehiculo-rapido-plate">Placa</Label>
              <Input id="vehiculo-rapido-plate" value={plate} onChange={(e) => setPlate(e.target.value)} />
              {errors.plate && (
                <p role="alert" className={FIELD_ERROR}>
                  {errors.plate}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vehiculo-rapido-make">Marca</Label>
              <Input id="vehiculo-rapido-make" value={make} onChange={(e) => setMake(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vehiculo-rapido-model">Modelo</Label>
              <Input id="vehiculo-rapido-model" value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vehiculo-rapido-year">Año</Label>
              <Input
                id="vehiculo-rapido-year"
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
              {errors.year && (
                <p role="alert" className={FIELD_ERROR}>
                  {errors.year}
                </p>
              )}
            </div>

            {errors.form && (
              <p role="alert" className={`${FIELD_ERROR} sm:col-span-2`}>
                {errors.form}
              </p>
            )}
          </DialogBody>

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" className="min-h-11 min-w-11" disabled={isSubmitting} />
              }
            >
              Cancelar
            </DialogClose>
            {/* "Guardar vehículo", not "Guardar": this dialog opens on top of
                `ServiceOrderForm`, whose own submit button is "Guardar". */}
            <Button type="submit" className="min-h-11 min-w-11" disabled={isSubmitting}>
              {isSubmitting ? "Guardando…" : "Guardar vehículo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
