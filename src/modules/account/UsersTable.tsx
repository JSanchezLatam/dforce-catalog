"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FIELD_ERROR } from "@/shared/ui/styles";

export type UserRow = {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  role: string;
  /** Serialised over the RSC boundary, so a string rather than a Date. */
  deactivatedAt: string | null;
};

const ROLE_LABELS: Record<string, string> = {
  tecnico: "Técnico de taller",
  administrador: "Administrador",
};

/**
 * The API answers a refused mutation with the machine reason from
 * `checkAdminSafety`. Echoing that raw code at an admin would be useless — each
 * one has a specific, actionable explanation.
 */
const REFUSAL_MESSAGES: Record<string, string> = {
  last_active_admin: "No se puede desactivar al último administrador activo.",
  self_deactivate: "No puedes desactivar tu propia cuenta desde esta pantalla.",
  self_role_change: "No puedes cambiar tu propio rol desde esta pantalla.",
  not_found: "Ese usuario ya no existe. Recarga la página.",
};

export function UsersTable({ users }: { users: UserRow[] }) {
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const router = useRouter();

  // Filtered here rather than refetched: a workshop has a handful of users, so
  // the page already holds them all and the toggle is instant.
  const visible = showInactive ? users : users.filter((u) => u.deactivatedAt === null);

  async function toggleActive(user: UserRow) {
    setError(null);
    setPendingId(user.id);

    let res: Response;
    try {
      res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: user.deactivatedAt !== null }),
      });
    } catch {
      setError("No se pudo conectar. Revisa tu conexión e intenta de nuevo.");
      setPendingId(null);
      return;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // No optimistic flip anywhere in this function: the server refused, so
      // the row must stay exactly as it was and the action stay available.
      setError(REFUSAL_MESSAGES[body.error] ?? "No se pudo completar la acción.");
      setPendingId(null);
      return;
    }

    setPendingId(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <input
          id="show-inactive"
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        <Label htmlFor="show-inactive">Mostrar inactivos</Label>
      </div>

      {error && (
        <p role="alert" className={FIELD_ERROR}>
          {error}
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Usuario</TableHead>
            <TableHead>Nombre</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Rol</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((user) => {
            const inactive = user.deactivatedAt !== null;
            return (
              <TableRow key={user.id} className={inactive ? "text-muted-foreground" : undefined}>
                <TableCell>{user.username}</TableCell>
                <TableCell>{user.name ?? "—"}</TableCell>
                <TableCell>{user.email ?? "—"}</TableCell>
                <TableCell>{ROLE_LABELS[user.role] ?? user.role}</TableCell>
                <TableCell>
                  {/* A text badge, not colour alone — a greyed row is
                      indistinguishable from an active one to a screen reader. */}
                  {inactive ? "Inactivo" : "Activo"}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant={inactive ? "outline" : "ghost"}
                    size="sm"
                    disabled={pendingId === user.id}
                    onClick={() => toggleActive(user)}
                  >
                    {inactive ? "Reactivar" : "Desactivar"}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {visible.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay usuarios para mostrar.</p>
      )}
    </div>
  );
}
