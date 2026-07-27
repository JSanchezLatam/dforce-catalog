"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FIELD_ERROR } from "@/shared/ui/styles";

export function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    if (newPassword !== confirmPassword) {
      setErrors({ confirmPassword: "Las contraseñas no coinciden." });
      return;
    }

    if (newPassword.length < 6) {
      setErrors({ newPassword: "La contraseña debe tener al menos 6 caracteres." });
      return;
    }

    setStatus("saving");

    const res = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    if (res.status === 400) {
      const body = await res.json();
      setErrors({ currentPassword: body.error ?? "Contraseña actual incorrecta." });
      setStatus("idle");
      return;
    }

    if (!res.ok) {
      setErrors({ form: "No se pudo cambiar la contraseña." });
      setStatus("idle");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setStatus("saved");
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="currentPassword">Contraseña actual</Label>
            <Input id="currentPassword" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          {errors.currentPassword && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.currentPassword}
            </p>
          )}

          <div className="grid gap-2">
            <Label htmlFor="newPassword">Nueva contraseña</Label>
            <Input id="newPassword" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          {errors.newPassword && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.newPassword}
            </p>
          )}

          <div className="grid gap-2">
            <Label htmlFor="confirmPassword">Confirmar nueva contraseña</Label>
            <Input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </div>
          {errors.confirmPassword && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.confirmPassword}
            </p>
          )}

          {errors.form && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.form}
            </p>
          )}

          <p className="text-xs text-muted-foreground">Al cambiar la contraseña, las demás sesiones se cerrarán.</p>

          <Button type="submit" disabled={status === "saving"} className="self-start">
            {status === "saving" ? "Guardando…" : "Cambiar contraseña"}
          </Button>
          {status === "saved" && <p className="text-sm text-green-600">Contraseña actualizada.</p>}
        </form>
      </CardContent>
    </Card>
  );
}
