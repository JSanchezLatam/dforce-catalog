"use client";

import { useState, type FormEvent } from "react";

import { FIELD_ERROR, INPUT, LABEL, PRIMARY_BUTTON } from "@/shared/ui/styles";

/**
 * R9.1/9.2 — plain credential form, same fetch-then-status-check shape as
 * `template-config/TemplateConfigForm.tsx`. On success, a full navigation
 * (not client-side router push) so the freshly-set `session` cookie is sent
 * on the very next request (`proxy.ts` reads it from the request, not from
 * client-side state).
 */
export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting">("idle");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setError(null);

    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      // R9.2 — generic message regardless of which credential was wrong.
      setError("Invalid username or password.");
      setStatus("idle");
      return;
    }

    window.location.href = "/inventory";
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className={LABEL}>
        Username
        <input
          className={`mt-1 ${INPUT}`}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
      </label>
      <label className={LABEL}>
        Password
        <input
          type="password"
          className={`mt-1 ${INPUT}`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      {error && (
        <p role="alert" className={FIELD_ERROR}>
          {error}
        </p>
      )}
      <button type="submit" disabled={status === "submitting"} className={PRIMARY_BUTTON}>
        {status === "submitting" ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
