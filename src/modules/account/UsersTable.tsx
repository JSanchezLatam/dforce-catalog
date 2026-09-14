"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS } from "@/modules/auth/roles";
import { BulkResultPanel } from "@/shared/ui/selection/BulkResultPanel";
import { RowActions } from "@/shared/ui/selection/RowActions";
import { RowCheckbox, SelectAllCheckbox } from "@/shared/ui/selection/RowCheckbox";
import { SelectionBar } from "@/shared/ui/selection/SelectionBar";
import { SelectionProvider } from "@/shared/ui/selection/SelectionProvider";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { useToast } from "@/shared/ui/ToastProvider";
import { REFUSAL_MESSAGES } from "./refusals";
import { UserBulkActions } from "./UserBulkActions";
import { UserForm } from "./UserForm";

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

export function UsersTable({ users }: { users: UserRow[] }) {
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort | null>(null);
  // The row being edited, NOT a boolean: one dialog serves the whole table, so
  // it has to know which row opened it. The comment on its JSX below says why
  // it cannot live inside the row's own kebab.
  const [editing, setEditing] = useState<UserRow | null>(null);
  const router = useRouter();
  const { addToast } = useToast();

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

  // The selection model's three inputs (design D3). `/users` needs no
  // `SelectionProvider` wrapper written for it — this component is already
  // `"use client"` and holds every row — but it still renders the shared
  // provider so `RowCheckbox`, `SelectionBar` and `BulkResultPanel` read the
  // one selection model rather than four copies of its filter rule (D4).
  //
  // `filterKey` is `showInactive` and nothing else: that toggle is this
  // table's only FILTER, and sorting a column must never clear a selection the
  // operator has been assembling. There is no pagination here to leave out.
  const pageIds = rows.map((u) => u.id);
  const labels = Object.fromEntries(rows.map((u) => [u.id, u.username]));
  const filterKey = `inactive=${showInactive}`;

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
    // The row is rendered by the SERVER, so nothing on screen changes until
    // the refresh lands — and the kebab that was clicked has already closed.
    // The toast goes first: the mutation is committed, and a refresh that
    // throws must not be able to swallow the only confirmation of it.
    //
    // `deactivatedAt` is the row as the server last rendered it, so a row that
    // HAD a timestamp is the one that was just reactivated.
    addToast("success", user.deactivatedAt !== null ? "Usuario reactivado" : "Usuario desactivado");
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

      <SelectionProvider pageIds={pageIds} labels={labels} filterKey={filterKey}>
        <SelectionBar>
          <UserBulkActions />
        </SelectionBar>
        {/* The refusal map is INJECTED, not owned by the panel: `not_found` means
            a different thing on `/customers` than it does here, and one shared
            vocabulary would make every page carry the other three's copy. */}
        <BulkResultPanel reasons={REFUSAL_MESSAGES} />

        {/* The Card wraps THE TABLE ONLY (D7) — the `Mostrar inactivos` toggle
            and the error above it stay outside, matching the other three list
            pages, where the filter strip is its own Card. */}
        <Card size="sm">
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  {/* `w-10` and no label — `table.tsx` already ships
                      `[&:has([role=checkbox])]:pr-0` on `TableHead`, so the
                      column needs no new table primitive. The accessible name
                      lives on the checkbox. Same shape as `customers/page.tsx`. */}
                  <TableHead className="w-10">
                    <SelectAllCheckbox />
                  </TableHead>
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
                      <TableCell>
                        <RowCheckbox id={user.id} label={user.username} />
                      </TableCell>
                      <TableCell>{user.username}</TableCell>
                      <TableCell>{user.name ?? "—"}</TableCell>
                      <TableCell>{user.email ?? "—"}</TableCell>
                      <TableCell>{roleLabel(user.role)}</TableCell>
                      <TableCell>
                        {/* Text, not colour alone — a greyed row is indistinguishable
                            from an active one to a screen reader. A real `Badge`
                            since D8; `StatusBadge` is untouched, because widening its
                            closed 14-member union for one column is a migration this
                            change does not own. */}
                        <Badge variant={inactive ? "outline" : "secondary"}>
                          {inactive ? "Inactivo" : "Activo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end">
                          <RowActions label={`Acciones de ${user.username}`}>
                            {/* Editing a deactivated user is not offered: reactivate
                                first, so the row's state stays unambiguous. */}
                            {!inactive && <DropdownMenuItem onClick={() => setEditing(user)}>Editar</DropdownMenuItem>}
                            {/* A plain item with `onClick`, NOT `render={<button/>}`.
                                Measured in jsdom against base-ui 1.6: with `render`,
                                ArrowDown+Enter activates the item 0 times out of 1 —
                                Enter reaches base-ui's own item handler, and
                                rendering a real `<button>` replaces it. That is the
                                REVERSE of unit 2's link item, where `render` was the
                                fix; what decides it is whether the thing has to stay
                                an anchor, not the `render` prop itself. */}
                            <DropdownMenuItem disabled={pendingId === user.id} onClick={() => toggleActive(user)}>
                              {inactive ? "Reactivar" : "Desactivar"}
                            </DropdownMenuItem>
                          </RowActions>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </SelectionProvider>

      {visible.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay usuarios para mostrar.</p>
      )}

      {/* ONE dialog for the table, mounted OUTSIDE every row's kebab — the one
          thing here that is not free to move. Measured in jsdom against
          base-ui 1.6:

          - Inside a `DropdownMenuItem`, selecting the item closes the menu and
            unmounts the dialog with it: 0 dialogs opened, mouse or keyboard.
          - As a plain child of the menu content the dialog DOES open, but the
            menu stays open behind it (`data-open` still set) and its
            `useTypeahead` `preventDefault`s every printable keydown, so the
            dialog cannot be typed into. React routes synthetic events along the
            REACT tree, not the DOM one, so portalling the dialog does not
            escape the menu — only mounting it outside does.

          `UserForm` rather than `UserFormTrigger`: that wrapper exists only to
          supply `onSaved` from a Server Component, and this file is already
          `"use client"` with a router of its own. */}
      {editing && (
        <UserForm
          user={editing}
          open
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
          // Always "actualizado": `editing` is a row that already exists, so
          // this dialog has no create branch — unlike `UserFormTrigger`,
          // which serves both.
          onSaved={() => {
            addToast("success", "Usuario actualizado");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
