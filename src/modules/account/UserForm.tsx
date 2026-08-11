"use client";

import { useState, type FormEvent, type ReactNode } from "react";

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLE_LABELS, type Role } from "@/modules/auth/roles";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { MIN_PASSWORD_LENGTH } from "./password-policy";

/** The subset of a user row this form can read; mirrors `UsersTable`'s `UserRow` minus the activation state. */
export type UserFormUser = {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  role: string;
};

type UserFormState = {
  username: string;
  name: string;
  email: string;
  role: Role | null;
  password: string;
  resetPassword: boolean;
};

function toFormState(user?: UserFormUser | null): UserFormState {
  return {
    username: user?.username ?? "",
    name: user?.name ?? "",
    email: user?.email ?? "",
    role: (user?.role as Role | undefined) ?? null,
    password: "",
    resetPassword: false,
  };
}

/**
 * The two 409 codes the API distinguishes (`route.ts` returns them separately
 * precisely so the form can mark the offending field) mapped onto that field.
 */
const DUPLICATE_MESSAGES: Record<string, { field: string; message: string }> = {
  duplicate_username: { field: "username", message: "Ya existe un usuario con ese nombre de usuario." },
  duplicate_email: { field: "email", message: "Ya existe un usuario con ese email." },
};

/**
 * WU5b — admin create/edit dialog for `users`. Mirrors `CustomerForm.tsx`'s
 * Dialog/`useState`/`FIELD_ERROR` shape; `UserFormTrigger.tsx` is the thin
 * wrapper that supplies `onSaved` from a Server Component page.
 *
 * Two things differ from the customer form on purpose:
 *
 * - **The username is read-only in edit mode.** `updateUser()`'s patch has no
 *   username branch, so an editable field would silently discard the change.
 * - **Password is opt-in on edit.** `PATCH` treats a present `password` as an
 *   admin reset, which re-arms `mustChangePassword` and kills every session
 *   the target has. That is far too destructive to trigger by leaving a
 *   pre-filled field alone, so it hides behind an explicit checkbox.
 */
export function UserForm({
  user,
  triggerLabel,
  onSaved,
}: {
  /** Provided => edit mode (PATCH); omitted => create mode (POST). */
  user?: UserFormUser | null;
  triggerLabel?: ReactNode;
  onSaved?: () => void;
}) {
  const isEdit = Boolean(user);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<UserFormState>(() => toFormState(user));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const wantsPassword = !isEdit || form.resetPassword;

  function update<K extends keyof UserFormState>(key: K, value: UserFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setForm(toFormState(user));
      setErrors({});
    }
  }

  /** Client-side floor only — the server re-validates all of this. Returns the field errors, empty when clean. */
  function validate(): Record<string, string> {
    const found: Record<string, string> = {};

    if (!isEdit && !form.username.trim()) {
      found.username = "El nombre de usuario es obligatorio.";
    }
    if (!form.role) {
      found.role = "El rol es obligatorio.";
    }
    if (wantsPassword && form.password.length < MIN_PASSWORD_LENGTH) {
      found.password = `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
    }

    return found;
  }

  /**
   * Create omits blank optionals so `createUser()` stores NULL; edit sends them
   * even when empty, because `updateUser()` only patches the keys it receives —
   * omitting a cleared email would leave the old address in place and make the
   * admin's deletion silently do nothing.
   */
  function buildPayload() {
    if (!isEdit) {
      return {
        username: form.username.trim(),
        role: form.role,
        password: form.password,
        ...(form.name.trim() ? { name: form.name.trim() } : {}),
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
      };
    }

    return {
      name: form.name.trim(),
      email: form.email.trim(),
      role: form.role,
      ...(form.resetPassword ? { password: form.password } : {}),
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const invalid = validate();
    if (Object.keys(invalid).length > 0) {
      setErrors(invalid);
      return;
    }

    setIsSubmitting(true);

    let response: Response;
    try {
      response = await fetch(isEdit ? `/api/users/${user!.id}` : "/api/users", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
    } catch {
      // Never leave Guardar disabled on a network failure — that stranded a
      // blocked user on the change-password screen in WU3 and was the one
      // CRITICAL the RDD review caught.
      setErrors({ form: "No se pudo conectar. Revisa tu conexión e intenta de nuevo." });
      setIsSubmitting(false);
      return;
    }

    try {
      if (response.status === 400) {
        const body = await response.json().catch(() => ({}));
        setErrors(body.errors ?? { form: "No se pudo guardar el usuario. Revisa los datos." });
        return;
      }

      if (response.status === 409) {
        const body = await response.json().catch(() => ({}));
        const duplicate = DUPLICATE_MESSAGES[body.error];
        setErrors(
          duplicate
            ? { [duplicate.field]: duplicate.message }
            : { form: "Ya existe un usuario con esos datos." },
        );
        return;
      }

      if (!response.ok) {
        setErrors({ form: "No se pudo guardar el usuario. Intentalo de nuevo." });
        return;
      }

      setOpen(false);
      onSaved?.();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant={isEdit ? "outline" : "default"} size={isEdit ? "sm" : "default"} />}>
        {triggerLabel ?? (isEdit ? "Editar" : "Nuevo usuario")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar usuario" : "Nuevo usuario"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="user-username">Usuario</Label>
            <Input
              id="user-username"
              value={form.username}
              readOnly={isEdit}
              aria-describedby={isEdit ? "user-username-hint" : undefined}
              onChange={(e) => update("username", e.target.value)}
            />
            {isEdit && (
              <p id="user-username-hint" className="text-xs text-muted-foreground">
                El nombre de usuario no se puede cambiar.
              </p>
            )}
            {errors.username && (
              <p role="alert" className={FIELD_ERROR}>
                {errors.username}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="user-name">Nombre</Label>
            <Input id="user-name" value={form.name} onChange={(e) => update("name", e.target.value)} />
            {errors.name && (
              <p role="alert" className={FIELD_ERROR}>
                {errors.name}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="user-email">Email</Label>
            <Input
              id="user-email"
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

          <div className="grid gap-2">
            <Label htmlFor="user-role">Rol</Label>
            {/* `items` lets SelectValue render the human label instead of the raw enum value. */}
            <Select
              items={ROLE_LABELS}
              value={form.role}
              onValueChange={(value) => update("role", (value as Role | null) ?? null)}
            >
              <SelectTrigger id="user-role" className="w-full">
                <SelectValue placeholder="Seleccioná un rol" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.role && (
              <p role="alert" className={FIELD_ERROR}>
                {errors.role}
              </p>
            )}
          </div>

          {/* `id` + `htmlFor` rather than CustomerForm's wrapping <label>: the
              base-ui Checkbox renders a button AND a hidden input, and a
              wrapping label points at both of them. */}
          {isEdit && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="user-reset-password"
                checked={form.resetPassword}
                onCheckedChange={(checked) => update("resetPassword", checked === true)}
              />
              <Label htmlFor="user-reset-password">Restablecer contraseña</Label>
            </div>
          )}

          {wantsPassword && (
            <div className="grid gap-2">
              <Label htmlFor="user-password">{isEdit ? "Nueva contraseña" : "Contraseña inicial"}</Label>
              <Input
                id="user-password"
                type="password"
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
              />
              {/* Both paths force a rotation on first login, so say so rather
                  than letting the admin assume this password is permanent. */}
              <p className="text-xs text-muted-foreground">
                El usuario deberá cambiarla la próxima vez que inicie sesión.
              </p>
              {errors.password && (
                <p role="alert" className={FIELD_ERROR}>
                  {errors.password}
                </p>
              )}
            </div>
          )}

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
