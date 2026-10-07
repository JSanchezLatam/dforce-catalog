"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { FIELD_ERROR } from "@/shared/ui/styles";

export type TechnicianFormTarget = { id: string; nombre: string; userId: string | null };
export type LoginOption = { id: string; username: string };

const NO_LOGIN = "none";

/**
 * Create/edit dialog for one roster row, always controlled: the roster mounts it
 * only while open (outside every kebab, the same constraint `UserForm` documents),
 * so state starts fresh each time and needs no reset.
 *
 * `logins` is `null` for a jefe_taller: the link control is not rendered and
 * `userId` is never sent, because the server answers 403 to a jefe that names it.
 */
export function TechnicianForm({
  technician,
  logins,
  onClose,
  onSaved,
}: {
  /** Provided => edit (PATCH); omitted => create (POST). */
  technician?: TechnicianFormTarget;
  logins: LoginOption[] | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(technician);
  const [nombre, setNombre] = useState(technician?.nombre ?? "");
  const [userId, setUserId] = useState<string>(technician?.userId ?? NO_LOGIN);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function buildPayload() {
    const body: { nombre: string; userId?: string | null } = { nombre: nombre.trim() };
    // A jefe has no link control, so `userId` never leaves its default and is
    // never sent. Edit resends the link only when it moved: a rename must not be refused
    // because the row's current login has since been deactivated.
    if (isEdit) {
      if (userId !== (technician!.userId ?? NO_LOGIN)) body.userId = userId === NO_LOGIN ? null : userId;
    } else if (userId !== NO_LOGIN) {
      body.userId = userId;
    }
    return body;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    if (!nombre.trim()) {
      setErrors({ nombre: "El nombre es obligatorio." });
      return;
    }

    setIsSubmitting(true);
    let response: Response;
    try {
      response = await fetch(isEdit ? `/api/technicians/${technician!.id}` : "/api/technicians", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
    } catch {
      // Never leave Guardar disabled on a network failure.
      setErrors({ form: CONNECTION_ERROR });
      setIsSubmitting(false);
      return;
    }

    try {
      if (response.ok) {
        onClose();
        onSaved();
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (response.status === 400) setErrors(body.errors ?? { form: "No se pudo guardar el técnico. Revisá los datos." });
      else if (response.status === 409) setErrors({ userId: body.error ?? "Ese usuario no se puede vincular." });
      else if (response.status === 404) setErrors({ form: "Ese técnico ya no existe. Recargá la página." });
      else if (response.status === 403) setErrors({ form: "No tenés permiso para hacer este cambio." });
      else setErrors({ form: "No se pudo guardar el técnico. Intentalo de nuevo." });
    } finally {
      setIsSubmitting(false);
    }
  }

  const items: Record<string, string> = { [NO_LOGIN]: "Sin usuario", ...Object.fromEntries((logins ?? []).map((l) => [l.id, l.username])) };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar técnico" : "Nuevo técnico"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogBody className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="technician-nombre">Nombre</Label>
              <Input id="technician-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
              {errors.nombre && (
                <p role="alert" className={FIELD_ERROR}>
                  {errors.nombre}
                </p>
              )}
            </div>

            {logins !== null && (
              <div className="grid gap-2">
                <Label htmlFor="technician-user">Usuario vinculado</Label>
                <Select items={items} value={userId} onValueChange={(value) => setUserId(value ?? NO_LOGIN)}>
                  <SelectTrigger id="technician-user" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(items).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.userId && (
                  <p role="alert" className={FIELD_ERROR}>
                    {errors.userId}
                  </p>
                )}
              </div>
            )}

            {errors.form && (
              <p role="alert" className={FIELD_ERROR}>
                {errors.form}
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
      </DialogContent>
    </Dialog>
  );
}
