"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS } from "@/modules/auth/roles";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { UserFormTrigger } from "./UserFormTrigger";

export type UserRow = {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  role: string;
  /** Serialised over the RSC boundary, so a string rather than a Date. */
  deactivatedAt: string | null;
};

/**
 * `role` crosses the RSC boundary as a plain `string`, so the lookup is cast
 * the way `app-sidebar.tsx:305` already does it, with the raw value as the
 * fallback for anything the shared map does not name.
 */
function roleLabel(role: string): string {
  return ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role;
}

type SortKey = "username" | "name" | "email" | "role" | "estado";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const es = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "", "es");

/**
 * The whitelist of sortable columns, one ascending comparator each. `Acciones`
 * is absent on purpose — there is nothing to order it by.
 *
 * `username` compares by code point: it is an ASCII login, not prose. The
 * three human-readable columns go through `localeCompare("es")` instead, which
 * is what reads `Á` as an accented `A` rather than as U+00C1 above `B`.
 * `role` compares the LABEL, so the order matches the column as rendered.
 */
const SORTERS: Record<SortKey, (a: UserRow, b: UserRow) => number> = {
  username: (a, b) => (a.username < b.username ? -1 : a.username > b.username ? 1 : 0),
  name: (a, b) => es(a.name, b.name),
  email: (a, b) => es(a.email, b.email),
  role: (a, b) => es(roleLabel(a.role), roleLabel(b.role)),
  // Ascending puts Activo first, matching both the label order and the reading
  // an operator expects from an "estado" column.
  estado: (a, b) => Number(a.deactivatedAt !== null) - Number(b.deactivatedAt !== null),
};

/**
 * `name` and `email` are the two nullable columns. The spec's NULL Ordering
 * requirement puts a missing value LAST in BOTH directions — a row with no
 * email is never more prominent than one that has it — so this is checked
 * before the direction multiplier is applied, exactly as the query-side units
 * put `nulls last` after the direction rather than inside the column
 * expression. A comparator alone cannot do it: negating it for `desc` would
 * flip the nulls back to the front.
 */
const MISSING: Partial<Record<SortKey, (row: UserRow) => boolean>> = {
  name: (row) => row.name === null,
  email: (row) => row.email === null,
};

function compare(a: UserRow, b: UserRow, sort: Sort): number {
  const missing = MISSING[sort.key];
  if (missing) {
    const [aMissing, bMissing] = [missing(a), missing(b)];
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
  }
  return SORTERS[sort.key](a, b) * (sort.dir === "asc" ? 1 : -1);
}

const COLUMNS: readonly { label: string; key: SortKey }[] = [
  { label: "Usuario", key: "username" },
  { label: "Nombre", key: "name" },
  { label: "Email", key: "email" },
  { label: "Rol", key: "role" },
  { label: "Estado", key: "estado" },
];

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
  const [sort, setSort] = useState<Sort | null>(null);
  const router = useRouter();

  // Filtered here rather than refetched: a workshop has a handful of users, so
  // the page already holds them all and the toggle is instant.
  const visible = showInactive ? users : users.filter((u) => u.deactivatedAt === null);

  // Sorted for the same reason, and over a COPY: when `showInactive` is on,
  // `visible` IS the `users` prop and `sort` would mutate the caller's array.
  //
  // There is deliberately no runtime whitelist guard here. `sort.key` is a
  // `SortKey`, and the only writer is the header click, which reads it from
  // the `COLUMNS` literal above — unlike the query-side `parse*Sort`
  // functions, no untrusted URL value ever reaches this lookup, so a guard
  // would be unreachable code wearing a comment that claimed otherwise.
  const rows = sort ? [...visible].sort((a, b) => compare(a, b, sort)) : visible;

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
      setError(CONNECTION_ERROR);
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
            {COLUMNS.map((column) => {
              const dir = sort?.key === column.key ? sort?.dir : undefined;
              return (
                <TableHead
                  key={column.key}
                  aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                >
                  {/* A real <button>, not an <a>: this component is already
                      "use client" and the sort never leaves the browser, so
                      there is no URL to navigate to. `min-h-11 min-w-11` is
                      the 44px hit target — a workshop tablet taps these. */}
                  <button
                    type="button"
                    onClick={() => setSort({ key: column.key, dir: dir === "asc" ? "desc" : "asc" })}
                    className="-mx-2 inline-flex min-h-11 min-w-11 items-center gap-1 px-2 hover:text-foreground"
                  >
                    {column.label}
                    {dir === "asc" && <ArrowUp className="h-3 w-3" aria-hidden="true" />}
                    {dir === "desc" && <ArrowDown className="h-3 w-3" aria-hidden="true" />}
                  </button>
                </TableHead>
              );
            })}
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((user) => {
            const inactive = user.deactivatedAt !== null;
            return (
              <TableRow key={user.id} className={inactive ? "text-muted-foreground" : undefined}>
                <TableCell>{user.username}</TableCell>
                <TableCell>{user.name ?? "—"}</TableCell>
                <TableCell>{user.email ?? "—"}</TableCell>
                <TableCell>{roleLabel(user.role)}</TableCell>
                <TableCell>
                  {/* A text badge, not colour alone — a greyed row is
                      indistinguishable from an active one to a screen reader. */}
                  {inactive ? "Inactivo" : "Activo"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {/* Editing a deactivated user is not offered: reactivate
                        first, so the row's state stays unambiguous. */}
                    {!inactive && <UserFormTrigger user={user} />}
                    <Button
                      variant={inactive ? "outline" : "ghost"}
                      size="sm"
                      disabled={pendingId === user.id}
                      onClick={() => toggleActive(user)}
                    >
                      {inactive ? "Reactivar" : "Desactivar"}
                    </Button>
                  </div>
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
