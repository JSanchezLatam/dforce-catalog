"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { THROTTLED, WRONG_PASSWORD } from "../../../src/support/messages";

const GENERIC = "No se pudo iniciar sesión. Probá de nuevo.";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<{ text: string; invalid: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/support/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace("/support");
        router.refresh();
        return;
      }
      setError(
        res.status === 401
          ? { text: WRONG_PASSWORD, invalid: true }
          : { text: res.status === 429 ? THROTTLED : GENERIC, invalid: false },
      );
    } catch {
      setError({ text: GENERIC, invalid: false });
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="pw">Contraseña</label>
        <input
          id="pw"
          name="password"
          type="password"
          className="input"
          autoComplete="current-password"
          aria-invalid={error?.invalid ? true : undefined}
          aria-describedby={error ? "pw-err" : undefined}
        />
        {error && (
          <p className="error" id="pw-err" role="alert">
            {error.text}
          </p>
        )}
      </div>
      <button className="btn" type="submit" disabled={busy}>
        Entrar
      </button>
    </form>
  );
}
