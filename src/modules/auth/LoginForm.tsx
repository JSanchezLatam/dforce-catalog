"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, type LoginState } from "@/modules/auth/actions";
import { FIELD_ERROR } from "@/shared/ui/styles";

const initialState: LoginState = null;

function validateField(value: string): string {
  return value ? "" : "Required";
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
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          name="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onBlur={() => setFieldError("username", username)}
          autoComplete="username"
          required
        />
        {fieldErrors.username && (
          <p className={FIELD_ERROR}>{fieldErrors.username}</p>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => setFieldError("password", password)}
          autoComplete="current-password"
          required
        />
        {fieldErrors.password && (
          <p className={FIELD_ERROR}>{fieldErrors.password}</p>
        )}
      </div>
      {state?.error && (
        <p role="alert" className={FIELD_ERROR}>
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending || !username || !password}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
