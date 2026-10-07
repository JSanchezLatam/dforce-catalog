"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { useToast } from "@/shared/ui/ToastProvider";
import { CorrectionPasswordField } from "./CorrectionPasswordField";
import type { OrderAssignee, OrderWorkLine } from "./order-team";
import type { OrderStatus } from "./transitions";
import { WorkLineDialog } from "./WorkLineDialog";

/** `2026-03-04` -> `04/03/2026`, by string: a `Date` would shift the day by the zone. */
const formatDay = (fecha: string) => fecha.split("-").reverse().join("/");

/** Mark ("Mi parte lista") and un-mark of the viewer's own assignment. */
function ParteListaButton({ orderId, marking }: { orderId: string; marking: boolean }) {
  const router = useRouter();
  const { addToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/service-orders/${orderId}/parte-lista`, { method: marking ? "POST" : "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        addToast("error", body?.message ?? "No se pudo actualizar tu parte.");
        return;
      }
    } catch {
      addToast("error", CONNECTION_ERROR);
      return;
    } finally {
      setIsSubmitting(false);
    }
    // ABOVE the refresh, both BELOW the try/catch: see `OrderStatusControls`.
    addToast("success", marking ? "Parte marcada como lista" : "Parte desmarcada");
    router.refresh();
  }

  return (
    <Button type="button" variant={marking ? "default" : "outline"} className="min-h-11 min-w-11" disabled={isSubmitting} onClick={submit}>
      {marking ? "Mi parte lista" : "Desmarcar mi parte"}
    </Button>
  );
}

function DeleteLineDialog({ orderId, line, correcting }: { orderId: string; line: OrderWorkLine; correcting: boolean }) {
  const router = useRouter();
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    setPassword("");
    setErrors({});
  }

  async function confirm() {
    setIsSubmitting(true);
    setErrors({});
    try {
      const response = await fetch(`/api/service-orders/${orderId}/work-lines/${line.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(correcting ? { password } : {}),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (correcting && (body?.error === "wrong_password" || body?.error === "throttled")) setErrors({ password: body.message });
        else setErrors({ form: body?.message ?? "No se pudo eliminar la línea." });
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
    addToast("success", "Línea eliminada");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" className="min-h-11 min-w-11" aria-label={`Eliminar línea de ${line.tecnicoNombre}: ${line.descripcion}`} />
        }
      >
        Eliminar
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogTitle>¿Eliminar esta línea de trabajo?</DialogTitle>
        <DialogBody className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{line.descripcion}</p>
          {correcting && <CorrectionPasswordField value={password} onChange={setPassword} error={errors.password} />}
          {errors.form && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.form}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={isSubmitting} className="min-h-11 min-w-11" />}>Cancelar</DialogClose>
          <Button className="min-h-11 min-w-11" disabled={isSubmitting || (correcting && password === "")} onClick={confirm}>
            {isSubmitting ? "Eliminando…" : "Eliminar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The body of the "Líneas de trabajo" card: the team with each one's total and
 * marked/pending state, every line, "Mi parte lista" for the viewer's own
 * assignment, and the add/edit/delete controls the viewer may use.
 *
 * Props are plain data and strings/booleans only (RSC boundary): `mode` is
 * `workLineMode(role, status)` and `canManageAll` is `service-orders.assign`,
 * both resolved by the page. The técnico's own-line and not-yet-marked
 * conditions are applied here, from data the page already passed; the server
 * stays the gate either way.
 */
export function OrderWorkCard({
  orderId,
  status,
  assignees,
  lines,
  mode,
  viewerTecnicoId,
  canManageAll,
}: {
  orderId: string;
  status: OrderStatus;
  assignees: OrderAssignee[];
  lines: OrderWorkLine[];
  mode: "write" | "correction" | "refused";
  viewerTecnicoId: string | null;
  canManageAll: boolean;
}) {
  const own = viewerTecnicoId ? assignees.find((a) => a.tecnicoId === viewerTecnicoId) : undefined;
  const correcting = mode === "correction";
  const canWriteFor = (tecnicoId: string) =>
    mode !== "refused" && (canManageAll || (own !== undefined && own.tecnicoId === tecnicoId && !own.parteLista));
  const addable = assignees.filter((a) => canWriteFor(a.tecnicoId));
  const minutesOf = (tecnicoId: string) => lines.filter((l) => l.tecnicoId === tecnicoId).reduce((sum, l) => sum + l.duracionMinutos, 0);

  const showMark = own !== undefined && !own.parteLista && status === "in_progress";
  const showUnmark = own !== undefined && own.parteLista && (status === "in_progress" || status === "ready_for_review");

  return (
    <div className="flex flex-col gap-4">
      {assignees.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {assignees.map((a) => (
            <li key={a.tecnicoId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-input px-3 py-2 text-sm">
              <span data-slot="assignee-name" className="font-medium">
                {a.nombre}
              </span>
              <span className="flex items-center gap-3">
                <span>{minutesOf(a.tecnicoId)} min</span>
                <span className={a.parteLista ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}>
                  {a.parteLista ? "Parte lista" : "Pendiente"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {(showMark || showUnmark || addable.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {showMark && <ParteListaButton orderId={orderId} marking />}
          {showUnmark && <ParteListaButton orderId={orderId} marking={false} />}
          {addable.length > 0 && (
            <WorkLineDialog
              orderId={orderId}
              assignees={addable.map(({ tecnicoId, nombre }) => ({ tecnicoId, nombre }))}
              correcting={correcting}
              triggerLabel="Agregar línea"
            />
          )}
        </div>
      )}
      {assignees.length === 0 && mode !== "refused" && canManageAll && (
        <p className="text-sm text-muted-foreground">Asigná un técnico para poder cargar líneas.</p>
      )}

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay líneas de trabajo.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lines.map((l) => (
            <li
              key={l.id}
              aria-label={`Línea de ${l.tecnicoNombre}`}
              className="flex flex-col gap-2 rounded-lg border border-input p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 text-sm">
                <p className="font-medium">{l.tecnicoNombre}</p>
                <p className="break-words">{l.descripcion}</p>
                <p className="text-muted-foreground">{`${l.duracionMinutos} min · ${formatDay(l.fecha)}`}</p>
              </div>
              {canWriteFor(l.tecnicoId) && (
                <div className="flex flex-wrap gap-2">
                  <WorkLineDialog
                    orderId={orderId}
                    line={l}
                    correcting={correcting}
                    triggerLabel="Editar"
                    triggerAriaLabel={`Editar línea de ${l.tecnicoNombre}: ${l.descripcion}`}
                  />
                  <DeleteLineDialog orderId={orderId} line={l} correcting={correcting} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
