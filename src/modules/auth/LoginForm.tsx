"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
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
      <div className="grid gap-2">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onBlur={() => setUsernameTouched(true)}
          autoComplete="username"
          required
        />
        {usernameTouched && !username && (
          <p className="text-sm text-destructive">Username is required</p>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => setPasswordTouched(true)}
          autoComplete="current-password"
          required
        />
        {passwordTouched && !password && (
          <p className="text-sm text-destructive">Password is required</p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={status === "submitting" || !username || !password}>
        {status === "submitting" ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
