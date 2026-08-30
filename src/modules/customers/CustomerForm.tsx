"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import type { Cliente, Vehiculo } from "@/shared/db/schema";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FIELD_ERROR, PLATE_BADGE, SECTION_HEADING } from "@/shared/ui/styles";

/**
 * One vehicle row in the form. `key` is a stable, client-only React key
 * (never sent to the server); `id` is present only for a vehicle that already
 * exists in `vehiculo` — its absence is what tells `buildPayload` to send an
 * insert instead of an update (design.md D5, plates are never the key).
 * `deactivated` mirrors a real `vehiculo.deactivatedAt`, but ALSO doubles as
 * "the staff member just removed this row" for a not-yet-saved vehicle —
 * `removeOrDeactivateVehicle` below tells the two apart by `id`.
 */
type VehiculoRow = {
  key: string;
  id?: string;
  plate: string;
  make: string;
  model: string;
  year: string;
  deactivated: boolean;
};

type CustomerFormState = {
  name: string;
  phone: string;
  email: string;
  vehicles: VehiculoRow[];
  whatsappOptOut: boolean;
  emailOptOut: boolean;
};

function emptyVehicleRow(): VehiculoRow {
  return { key: crypto.randomUUID(), plate: "", make: "", model: "", year: "", deactivated: false };
}

function toFormState(cliente?: Cliente | null, vehicles?: Vehiculo[] | null): CustomerFormState {
  return {
    name: cliente?.name ?? "",
    phone: cliente?.phone ?? "",
    email: cliente?.email ?? "",
    vehicles: (vehicles ?? []).map((v) => ({
      key: v.id,
      id: v.id,
      plate: v.plate,
      make: v.make ?? "",
      model: v.model ?? "",
      year: v.year != null ? String(v.year) : "",
      deactivated: v.deactivatedAt !== null,
    })),
    whatsappOptOut: cliente?.whatsappOptOut ?? false,
    emailOptOut: cliente?.emailOptOut ?? false,
  };
}

/** Active rows in submission order — the index a server-side `vehicles.<i>.<field>` error refers to. */
function activeVehicles(vehicles: VehiculoRow[]) {
  return vehicles.filter((v) => !v.deactivated);
}

/** Sends `undefined` (omitted) for blank optional fields — matches validation.ts's `trimmedOrUndefined`. */
function buildPayload(form: CustomerFormState) {
  return {
    name: form.name,
    phone: form.phone,
    email: form.email.trim() || undefined,
    // Deactivated rows are OMITTED, not sent with a flag: the server infers
    // "deactivate" from a previously-active vehicle's id being absent from
    // this array (design.md D5) — that is the whole mechanism, both here and
    // for a never-saved row that was simply removed before ever being sent.
    vehicles: activeVehicles(form.vehicles).map((v) => ({
      ...(v.id !== undefined ? { id: v.id } : {}),
      plate: v.plate.trim(),
      make: v.make.trim() || undefined,
      model: v.model.trim() || undefined,
      year: v.year.trim() ? Number(v.year) : undefined,
    })),
    whatsappOptOut: form.whatsappOptOut,
    emailOptOut: form.emailOptOut,
  };
}

/**
 * R16/R17/R18/R26 — create/edit `cliente`. `"use client"`, `useState` for
 * fields + `errors`, shadcn `Dialog`+`Input`+`Label`+`Button`+`Checkbox`,
 * `FIELD_ERROR` for messages — mirrors `CatalogBuilderForm.tsx`'s error
 * handling and `TemplateConfigForm.tsx`'s controlled-input shape. POSTs to
 * `/api/customers` (create) or PATCHes `/api/customers/[id]` (edit, when
 * `cliente` is supplied) — the two routes from tasks 5.1/5.2.
 *
 * Vehicles (vehicles-one-to-many, C3): a repeating card group, not four flat
 * inputs. `vehicles` — the customer's WHOLE collection, active and inactive
 * (`getClienteById` fetches both) — is what makes restore possible: a
 * deactivated vehicle stays on screen, visibly secondary, with its own
 * restore action, rather than a hidden-by-default list (`UsersTable`'s
 * `showInactive` toggle is the right idiom for a many-row admin table; one
 * customer's handful of vehicles is small enough to just always show).
 */
export function CustomerForm({
  cliente,
  vehicles,
  triggerLabel,
  onSaved,
}: {
  /** Provided => edit mode (PATCH); omitted => create mode (POST). */
  cliente?: Cliente | null;
  /** The customer's whole vehicle collection (active + inactive) — ignored in create mode. */
  vehicles?: Vehiculo[] | null;
  triggerLabel?: ReactNode;
  /** `plates` is exactly what this save just sent — the API's 201/200 body carries no `vehicles`/`plates` of its own. */
  onSaved?: (cliente: Cliente, plates: string[]) => void;
}) {
  const isEdit = Boolean(cliente);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CustomerFormState>(() => toFormState(cliente, vehicles));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function update<K extends keyof CustomerFormState>(key: K, value: CustomerFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateVehicle(rowKey: string, patch: Partial<VehiculoRow>) {
    setForm((prev) => ({
      ...prev,
      vehicles: prev.vehicles.map((v) => (v.key === rowKey ? { ...v, ...patch } : v)),
    }));
  }

  function addVehicle() {
    setForm((prev) => ({ ...prev, vehicles: [...prev.vehicles, emptyVehicleRow()] }));
  }

  /** A never-saved row (`id` undefined) is dropped outright; an existing one is marked deactivated (soft delete, D5). */
  function removeOrDeactivateVehicle(rowKey: string) {
    setForm((prev) => ({
      ...prev,
      vehicles: prev.vehicles.flatMap((v) => {
        if (v.key !== rowKey) return [v];
        return v.id === undefined ? [] : [{ ...v, deactivated: true }];
      }),
    }));
  }

  function restoreVehicle(rowKey: string) {
    setForm((prev) => ({
      ...prev,
      vehicles: prev.vehicles.map((v) => (v.key === rowKey ? { ...v, deactivated: false } : v)),
    }));
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setForm(toFormState(cliente, vehicles));
      setErrors({});
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrors({});

    try {
      const payload = buildPayload(form);
      const response = await fetch(isEdit ? `/api/customers/${cliente!.id}` : "/api/customers", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.status === 400) {
        const body = await response.json();
        setErrors(body.errors ?? {});
        return;
      }

      if (response.status === 409) {
        const body = await response.json();
        setErrors({
          phone: `Ya existe un cliente con este teléfono (ver /customers/${body.existingClienteId})`,
        });
        return;
      }

      if (!response.ok) {
        setErrors({ form: "No se pudo guardar el cliente. Intentalo de nuevo." });
        return;
      }

      const body = await response.json();
      setOpen(false);
      onSaved?.(body.cliente, payload.vehicles.map((v) => v.plate));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant={isEdit ? "outline" : "default"} size={isEdit ? "sm" : "default"} />}>
        {triggerLabel ?? (isEdit ? "Editar" : "Nuevo cliente")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="cliente-name">Nombre</Label>
            <Input id="cliente-name" value={form.name} onChange={(e) => update("name", e.target.value)} />
            {errors.name && (
              <p role="alert" className={FIELD_ERROR}>
                {errors.name}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cliente-phone">Teléfono</Label>
            <Input id="cliente-phone" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
            {errors.phone && (
              <p role="alert" className={FIELD_ERROR}>
                {errors.phone}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cliente-email">Email</Label>
            <Input
              id="cliente-email"
              type="email"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
            />
            {errors.email && (
              <p role="alert" className={FIELD_ERROR}>
                {errors.email}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <h3 className={SECTION_HEADING}>Vehículos</h3>
            {activeVehiculoIndices(form.vehicles).map(({ row, index, sentIndex }) => {
              const plateError = sentIndex >= 0 ? errors[`vehicles.${sentIndex}.plate`] : undefined;
              return (
                <div
                  key={row.key}
                  role="group"
                  aria-label={`Vehículo ${index}`}
                  className={
                    "flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" +
                    (row.deactivated ? " opacity-70" : "")
                  }
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={PLATE_BADGE}>{row.plate.trim() || "Sin placa"}</span>
                    {row.deactivated && (
                      <span className="text-xs font-medium text-muted-foreground">Vehículo desactivado</span>
                    )}
                    {row.deactivated ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-11 min-w-11"
                        onClick={() => restoreVehicle(row.key)}
                      >
                        {`Restaurar vehículo ${index}`}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-h-11 min-w-11"
                        onClick={() => removeOrDeactivateVehicle(row.key)}
                      >
                        {`Quitar vehículo ${index}`}
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <Label htmlFor={`${row.key}-plate`}>Placa</Label>
                      <Input
                        id={`${row.key}-plate`}
                        value={row.plate}
                        disabled={row.deactivated}
                        onChange={(e) => updateVehicle(row.key, { plate: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`${row.key}-make`}>Marca</Label>
                      <Input
                        id={`${row.key}-make`}
                        value={row.make}
                        disabled={row.deactivated}
                        onChange={(e) => updateVehicle(row.key, { make: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`${row.key}-model`}>Modelo</Label>
                      <Input
                        id={`${row.key}-model`}
                        value={row.model}
                        disabled={row.deactivated}
                        onChange={(e) => updateVehicle(row.key, { model: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`${row.key}-year`}>Año</Label>
                      <Input
                        id={`${row.key}-year`}
                        type="number"
                        value={row.year}
                        disabled={row.deactivated}
                        onChange={(e) => updateVehicle(row.key, { year: e.target.value })}
                      />
                    </div>
                  </div>

                  {plateError && (
                    <p role="alert" className={FIELD_ERROR}>
                      {plateError}
                    </p>
                  )}
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" className="min-h-11 min-w-11" onClick={addVehicle}>
              Agregar vehículo
            </Button>
          </div>

          {/* R26 — two independent per-channel opt-out flags, re-checked at reminder fire time. */}
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Checkbox
                checked={form.whatsappOptOut}
                onCheckedChange={(checked) => update("whatsappOptOut", checked === true)}
              />
              No enviar recordatorios por WhatsApp
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Checkbox
                checked={form.emailOptOut}
                onCheckedChange={(checked) => update("emailOptOut", checked === true)}
              />
              No enviar recordatorios por email
            </label>
          </div>

          {errors.form && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.form}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={isSubmitting} />}>
              Cancelar
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Pairs each row with its 1-based display index and its index within the ACTIVE-only array the server sees (-1 for a deactivated row, which has no server-side error slot). */
function activeVehiculoIndices(vehicles: VehiculoRow[]) {
  let sentIndex = -1;
  return vehicles.map((row, i) => {
    if (!row.deactivated) sentIndex += 1;
    return { row, index: i + 1, sentIndex: row.deactivated ? -1 : sentIndex };
  });
}
