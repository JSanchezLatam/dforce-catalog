"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { RecordCard, RecordCardList } from "@/shared/ui/RecordCard";
import { RowActions } from "@/shared/ui/selection/RowActions";
import { StatusBadge } from "@/shared/ui/StatusBadge";
import { DEACTIVATED_CHIP, FIELD_ERROR } from "@/shared/ui/styles";
import { useToast } from "@/shared/ui/ToastProvider";
import { TechnicianForm, type LoginOption } from "./TechnicianForm";

export type TechnicianRow = {
  id: string;
  nombre: string;
  userId: string | null;
  username: string | null;
  /** Serialised over the RSC boundary, so a string rather than a Date. */
  deactivatedAt: string | null;
};

type Dialog = { mode: "create" } | { mode: "edit"; row: TechnicianRow };

/**
 * The roster list. `canLink` is an administrador-only capability (the server
 * enforces it too); for a jefe `logins` is ignored and the form shows no link
 * control. Table from `md:` and `RecordCardList` below it, like `UsersTable`.
 */
export function TechnicianRoster({
  technicians,
  logins,
  canLink,
}: {
  technicians: TechnicianRow[];
  logins: LoginOption[];
  canLink: boolean;
}) {
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const router = useRouter();
  const { addToast } = useToast();

  const rows = showInactive ? technicians : technicians.filter((t) => t.deactivatedAt === null);

  async function toggleActive(row: TechnicianRow) {
    setError(null);
    setPendingId(row.id);

    let res: Response;
    try {
      res = await fetch(`/api/technicians/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: row.deactivatedAt !== null }),
      });
    } catch {
      setError(CONNECTION_ERROR);
      setPendingId(null);
      return;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error === "not_found" ? "Ese técnico ya no existe. Recargá la página." : "No se pudo completar la acción.");
      setPendingId(null);
      return;
    }

    setPendingId(null);
    // Toast first, refresh second, both below the try/catch: the mutation is
    // committed, and a refresh that throws must not swallow its confirmation.
    addToast("success", row.deactivatedAt !== null ? "Técnico reactivado" : "Técnico desactivado");
    router.refresh();
  }

  // One menu for the table row AND the phone card, so they cannot drift apart.
  function rowActions(row: TechnicianRow) {
    const inactive = row.deactivatedAt !== null;
    return (
      <RowActions label={`Acciones de ${row.nombre}`}>
        {!inactive && <DropdownMenuItem onClick={() => setDialog({ mode: "edit", row })}>Editar</DropdownMenuItem>}
        <DropdownMenuItem disabled={pendingId === row.id} onClick={() => toggleActive(row)}>
          {inactive ? "Reactivar" : "Desactivar"}
        </DropdownMenuItem>
      </RowActions>
    );
  }

  // The editing row's own login stays selectable even when it is no longer in
  // `logins` (deactivated); a login another row holds is not offered.
  function loginOptionsFor(row?: TechnicianRow): LoginOption[] | null {
    if (!canLink) return null;
    const heldByOthers = new Set(technicians.filter((t) => t.userId && t.id !== row?.id).map((t) => t.userId));
    const options = logins.filter((l) => !heldByOthers.has(l.id));
    if (row?.userId && row.username && !options.some((l) => l.id === row.userId)) {
      options.push({ id: row.userId, username: row.username });
    }
    return options;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            id="show-inactive-technicians"
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 rounded border-input pointer-coarse:size-6"
          />
          <Label htmlFor="show-inactive-technicians" className="pointer-coarse:min-h-11">
            Mostrar inactivos
          </Label>
        </div>
        <Button className="min-h-11 min-w-11" onClick={() => setDialog({ mode: "create" })}>
          Nuevo técnico
        </Button>
      </div>

      {error && (
        <p role="alert" className={FIELD_ERROR}>
          {error}
        </p>
      )}

      <Card size="sm" className="hidden md:block" data-testid="technicians-table">
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Usuario</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const inactive = row.deactivatedAt !== null;
                return (
                  <TableRow key={row.id} className={inactive ? "text-muted-foreground" : undefined}>
                    <TableCell>{row.nombre}</TableCell>
                    <TableCell>{row.username ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={inactive ? "outline" : "secondary"}>{inactive ? "Desactivado" : "Activo"}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end">{rowActions(row)}</div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <RecordCardList testId="technicians-cards">
        {rows.map((row) => (
          <RecordCard key={row.id} action={<div className="flex justify-end">{rowActions(row)}</div>}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium">{row.nombre}</div>
                {row.username && <div className="text-xs text-muted-foreground">{row.username}</div>}
              </div>
              {row.deactivatedAt !== null ? (
                <span className={`shrink-0 ${DEACTIVATED_CHIP}`}>Desactivado</span>
              ) : (
                <StatusBadge status="done" label="Activo" className="shrink-0" />
              )}
            </div>
          </RecordCard>
        ))}
      </RecordCardList>

      {rows.length === 0 && <p className="text-sm text-muted-foreground">No hay técnicos para mostrar.</p>}

      {/* Mounted outside every kebab: a dialog inside a base-ui menu is unmounted
          or has its typing swallowed (see `UsersTable`). Keyed per target so the
          form state is fresh each time it opens. */}
      {dialog && (
        <TechnicianForm
          key={dialog.mode === "edit" ? dialog.row.id : "create"}
          technician={dialog.mode === "edit" ? dialog.row : undefined}
          logins={loginOptionsFor(dialog.mode === "edit" ? dialog.row : undefined)}
          onClose={() => setDialog(null)}
          onSaved={() => {
            addToast("success", dialog.mode === "edit" ? "Técnico actualizado" : "Técnico creado");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
