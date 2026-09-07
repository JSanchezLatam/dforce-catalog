"use client";

import { useActionState, useState } from "react";
import { Lock, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, type LoginState } from "@/modules/auth/actions";
import { FIELD_ERROR } from "@/shared/ui/styles";

const initialState: LoginState = null;

function validateField(value: string): string {
  return value ? "" : "Requerido";
}

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  function setFieldError(field: string, value: string) {
    setFieldErrors((prev) => ({ ...prev, [field]: validateField(value) }));
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="username" className="text-[13px] font-semibold text-foreground">
          Usuario
        </Label>
        <div className="relative flex items-center">
          <User className="pointer-events-none absolute left-3 size-4 text-muted-foreground" aria-hidden="true" />
          <Input
            id="username"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onBlur={() => setFieldError("username", username)}
            autoComplete="username"
            required
            placeholder="Ingresa tu nombre de usuario"
            className="h-11 rounded-xl bg-background/70 pl-10 pr-3 shadow-inner placeholder:text-muted-foreground/70"
          />
        </div>
        {fieldErrors.username && <p className={FIELD_ERROR}>{fieldErrors.username}</p>}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password" className="text-[13px] font-semibold text-foreground">
          Contraseña
        </Label>
        <div className="relative flex items-center">
          <Lock className="pointer-events-none absolute left-3 size-4 text-muted-foreground" aria-hidden="true" />
          <Input
            id="password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setFieldError("password", password)}
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className="h-11 rounded-xl bg-background/70 pl-10 pr-3 shadow-inner placeholder:text-muted-foreground/70"
          />
        </div>
        {fieldErrors.password && <p className={FIELD_ERROR}>{fieldErrors.password}</p>}
      </div>
      {state?.error && (
        <p role="alert" className={FIELD_ERROR}>
          {state.error}
        </p>
      )}
      <Button
        type="submit"
        disabled={pending || !username || !password}
        className="h-11 w-full rounded-xl bg-[var(--login-brand)] font-semibold text-[var(--login-brand-foreground)] shadow-[0_1px_2px_rgb(0_0_0_/_0.15),0_6px_16px_hsl(5_85%_45%_/_0.28)] hover:bg-[var(--login-brand-hover)]"
      >
        {pending ? "Iniciando sesión…" : "Iniciar sesión"}
      </Button>
    </form>
  );
}
