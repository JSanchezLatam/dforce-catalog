"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import type { Cliente } from "@/shared/db/schema";
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
import { FIELD_ERROR } from "@/shared/ui/styles";

type CustomerFormState = {
  name: string;
  phone: string;
  email: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: string;
  vehiclePlate: string;
  whatsappOptOut: boolean;
  emailOptOut: boolean;
};

function toFormState(cliente?: Cliente | null): CustomerFormState {
  return {
    name: cliente?.name ?? "",
    phone: cliente?.phone ?? "",
    email: cliente?.email ?? "",
    vehicleMake: cliente?.vehicleMake ?? "",
    vehicleModel: cliente?.vehicleModel ?? "",
    vehicleYear: cliente?.vehicleYear != null ? String(cliente.vehicleYear) : "",
    vehiclePlate: cliente?.vehiclePlate ?? "",
    whatsappOptOut: cliente?.whatsappOptOut ?? false,
    emailOptOut: cliente?.emailOptOut ?? false,
  };
}

/** Sends `undefined` (omitted) for blank optional fields — matches validation.ts's `trimmedOrUndefined`. */
function buildPayload(form: CustomerFormState) {
  return {
    name: form.name,
    phone: form.phone,
    email: form.email.trim() || undefined,
    vehicleMake: form.vehicleMake.trim() || undefined,
    vehicleModel: form.vehicleModel.trim() || undefined,
    vehicleYear: form.vehicleYear.trim() ? Number(form.vehicleYear) : undefined,
    vehiclePlate: form.vehiclePlate.trim() || undefined,
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
 */
export function CustomerForm({
  cliente,
  triggerLabel,
  onSaved,
}: {
  /** Provided => edit mode (PATCH); omitted => create mode (POST). */
  cliente?: Cliente | null;
  triggerLabel?: ReactNode;
  onSaved?: (cliente: Cliente) => void;
}) {
  const isEdit = Boolean(cliente);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CustomerFormState>(() => toFormState(cliente));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function update<K extends keyof CustomerFormState>(key: K, value: CustomerFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setForm(toFormState(cliente));
      setErrors({});
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrors({});

    try {
      const response = await fetch(isEdit ? `/api/customers/${cliente!.id}` : "/api/customers", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(form)),
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
      onSaved?.(body.cliente);
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

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="cliente-vehicle-make">Marca</Label>
              <Input
                id="cliente-vehicle-make"
                value={form.vehicleMake}
                onChange={(e) => update("vehicleMake", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cliente-vehicle-model">Modelo</Label>
              <Input
                id="cliente-vehicle-model"
                value={form.vehicleModel}
                onChange={(e) => update("vehicleModel", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cliente-vehicle-year">Año</Label>
              <Input
                id="cliente-vehicle-year"
                type="number"
                value={form.vehicleYear}
                onChange={(e) => update("vehicleYear", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cliente-vehicle-plate">Placa</Label>
              <Input
                id="cliente-vehicle-plate"
                value={form.vehiclePlate}
                onChange={(e) => update("vehiclePlate", e.target.value)}
              />
            </div>
          </div>
          {errors.vehiclePlate && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.vehiclePlate}
            </p>
          )}

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
