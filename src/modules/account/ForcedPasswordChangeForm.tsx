"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { MIN_PASSWORD_LENGTH } from "./password-policy";

/**
 * The forced-rotation screen (design.md Decision 8). Deliberately NOT the
 * self-service `PasswordForm`: this one names the field "temporal", enforces
 * the must-differ rule, navigates into the app on success, and carries its own
 * logout control — the self-service form lives inside the app shell, which a
 * flagged user cannot reach.
 *
 * It posts to the same `POST /api/account/password` as self-service, with the
 * same `currentPassword` verification. A separate route that skipped that
 * verification would be an authenticated-but-unverified password overwrite —
 * a stolen-cookie account-takeover primitive, on exactly the accounts most
 * likely to have a freshly-handed-over credential.
 */
export function ForcedPasswordChangeForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "leaving">("idle");
  const router = useRouter();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }

    // Mirrors the server-side rule in service.ts — enforced there too, since a
    // client check is a convenience, never a guarantee.
    if (newPassword === currentPassword) {
      setError("La nueva contraseña debe ser distinta de la actual.");
      return;
    }

    setStatus("saving");

    // A rejected fetch (offline, DNS failure, connection reset) must land back
    // on "idle" with a visible message. Without this the button stays disabled
    // forever on a transient network blip — and since a flagged user is blocked
    // from every other surface, that hangs the account's only unlock path until
    // they think to reload the page.
    let res: Response;
    try {
      res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
    } catch {
      setError(CONNECTION_ERROR);
      setStatus("idle");
      return;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "No se pudo cambiar la contraseña.");
      setStatus("idle");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");

    // push, not refresh: the flag is cleared server-side now, so the proxy will
    // stop redirecting — but refreshing this route would just re-render the
    // same screen the user has finished with.
    router.push("/");
  }

  async function handleLogout() {
    setStatus("leaving");
    try {
      await fetch("/api/logout", { method: "POST" });
      router.push("/login");
    } catch {
      setStatus("idle");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="currentPassword">Contraseña temporal</Label>
        <Input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="newPassword">Nueva contraseña</Label>
        <Input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="confirmPassword">Confirmar nueva contraseña</Label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className={FIELD_ERROR}>
          {error}
        </p>
      )}

      <Button type="submit" disabled={status === "saving"}>
        {status === "saving" ? "Guardando…" : "Cambiar contraseña"}
      </Button>

      {/*
        The escape hatch. /api/logout is one of the three paths exempt from the
        forced-change block precisely so this control works — without it a user
        unwilling to rotate has no way out of the screen.
      */}
      <Button
        type="button"
        variant="ghost"
        onClick={handleLogout}
        disabled={status === "leaving"}
        className="text-muted-foreground"
      >
        Cerrar sesión
      </Button>
    </form>
  );
}
