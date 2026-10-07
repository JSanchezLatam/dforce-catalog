"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { useToast } from "@/shared/ui/ToastProvider";
import { CorrectionPasswordField } from "./CorrectionPasswordField";

export type WorkLineFields = { id: string; tecnicoId: string; descripcion: string; duracionMinutos: number; fecha: string };

/** Error keys the form has a place to show. Anything else routes to `form`. */
const RENDERED = new Set(["tecnicoId", "descripcion", "duracionMinutos", "fecha", "form", "password"]);

const NATIVE_SELECT =
  "min-h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** The workshop's calendar day as `YYYY-MM-DD`, from LOCAL getters: `toISOString()` is the UTC day. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Adds a work line (no `line`) or edits one (`line`). In add mode `assignees`
 * are the technicians the viewer may name: several => a select, exactly one (a
 * técnico's own) => named, not asked. Edit never changes the technician. With
 * `correcting` (a closed order, administrador) every save asks for the password,
 * held only while the dialog is open. Only strings, numbers and booleans in
 * props: it is mounted from a client card, but stays serializable all the same.
 */
export function WorkLineDialog({
  orderId,
  line,
  assignees = [],
  correcting,
  triggerLabel,
  triggerAriaLabel,
}: {
  orderId: string;
  line?: WorkLineFields;
  assignees?: { tecnicoId: string; nombre: string }[];
  correcting: boolean;
  triggerLabel: string;
  triggerAriaLabel?: string;
}) {
  const router = useRouter();
  const { addToast } = useToast();
  const isEdit = Boolean(line);
  const [open, setOpen] = useState(false);
  const [tecnicoId, setTecnicoId] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [minutos, setMinutos] = useState("");
  const [fecha, setFecha] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fixed = !isEdit && assignees.length === 1 ? assignees[0] : null;
  const chosenTecnicoId = fixed?.tecnicoId ?? tecnicoId;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    setPassword("");
    setErrors({});
    if (!next) return;
    setTecnicoId("");
    setDescripcion(line?.descripcion ?? "");
    setMinutos(line ? String(line.duracionMinutos) : "");
    setFecha(line?.fecha ?? today());
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrors({});

    const minutes = minutos.trim() === "" ? undefined : Number(minutos);
    // An edit sends only what changed, so the audit trail names only what changed.
    const fields = line
      ? {
          ...(descripcion.trim() !== line.descripcion ? { descripcion: descripcion.trim() } : {}),
          ...(minutes !== line.duracionMinutos ? { duracionMinutos: minutes } : {}),
          ...(fecha !== line.fecha ? { fecha } : {}),
        }
      : { tecnicoId: chosenTecnicoId, descripcion: descripcion.trim(), duracionMinutos: minutes, fecha };

    try {
      const response = await fetch(
        line ? `/api/service-orders/${orderId}/work-lines/${line.id}` : `/api/service-orders/${orderId}/work-lines`,
        {
          method: line ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...fields, ...(correcting ? { password } : {}) }),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (body?.errors) {
          const unrendered = Object.entries(body.errors as Record<string, string>).filter(([key]) => !RENDERED.has(key));
          setErrors(
            unrendered.length > 0 ? { ...body.errors, form: unrendered.map(([, message]) => message).join(" ") } : body.errors,
          );
        } else if (correcting && (body?.error === "wrong_password" || body?.error === "throttled")) {
          setErrors({ password: body.message });
        } else {
          setErrors({ form: body?.message ?? "No se pudo guardar la línea de trabajo." });
        }
        return;
      }
    } catch {
      setErrors({ form: CONNECTION_ERROR });
      return;
    } finally {
      setIsSubmitting(false);
      setPassword("");
    }

    setOpen(false);
    // ABOVE the refresh, both BELOW the try/catch: see `OrderStatusControls`.
    addToast("success", isEdit ? "Línea actualizada" : "Línea agregada");
    router.refresh();
  }

  const title = isEdit ? "Editar línea de trabajo" : "Agregar línea de trabajo";
  const blocked = isSubmitting || (!isEdit && chosenTecnicoId === "") || (correcting && password === "");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={<Button variant={isEdit ? "outline" : "default"} className="min-h-11 min-w-11" aria-label={triggerAriaLabel} />}
      >
        {triggerLabel}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogBody className="flex flex-col gap-4">
            {fixed && (
              <p className="text-sm">
                <span className="text-muted-foreground">Técnico: </span>
                {fixed.nombre}
              </p>
            )}
            {!isEdit && !fixed && (
              <div className="grid gap-2">
                <Label htmlFor="linea-tecnico">Técnico</Label>
                <select id="linea-tecnico" className={NATIVE_SELECT} value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)}>
                  <option value="">Elegí un técnico</option>
                  {assignees.map((a) => (
                    <option key={a.tecnicoId} value={a.tecnicoId}>
                      {a.nombre}
                    </option>
                  ))}
                </select>
                {errors.tecnicoId && (
                  <p role="alert" className={FIELD_ERROR}>
                    {errors.tecnicoId}
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="linea-descripcion">Qué se hizo</Label>
              <textarea
                id="linea-descripcion"
                className="min-h-20 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
              />
              {errors.descripcion && (
                <p role="alert" className={FIELD_ERROR}>
                  {errors.descripcion}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="linea-minutos">Minutos</Label>
                <Input
                  id="linea-minutos"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1440}
                  step={1}
                  placeholder="Ej. 45"
                  className="min-h-11"
                  value={minutos}
                  onChange={(e) => setMinutos(e.target.value)}
                />
                {errors.duracionMinutos && (
                  <p role="alert" className={FIELD_ERROR}>
                    {errors.duracionMinutos}
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="linea-fecha">Fecha</Label>
                {/* Native date input: a local `YYYY-MM-DD`, stored as `date`, so no timezone shift. */}
                <Input id="linea-fecha" type="date" className="min-h-11" value={fecha} onChange={(e) => setFecha(e.target.value)} />
                {errors.fecha && (
                  <p role="alert" className={FIELD_ERROR}>
                    {errors.fecha}
                  </p>
                )}
              </div>
            </div>

            {correcting && <CorrectionPasswordField value={password} onChange={setPassword} error={errors.password} />}

            {errors.form && (
              <p role="alert" className={FIELD_ERROR}>
                {errors.form}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={isSubmitting} className="min-h-11 min-w-11" />}>
              Cancelar
            </DialogClose>
            <Button type="submit" className="min-h-11 min-w-11" disabled={blocked}>
              {isSubmitting ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
