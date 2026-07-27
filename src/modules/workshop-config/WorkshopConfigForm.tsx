"use client";

import { useState, type FormEvent } from "react";

import type { WorkshopConfig } from "@/shared/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { LogoUploadField } from "./LogoUploadField";

type Props = {
  initialConfig: WorkshopConfig | null;
};

export function WorkshopConfigForm({ initialConfig }: Props) {
  const [name, setName] = useState(initialConfig?.name ?? "");
  const [logoKey, setLogoKey] = useState<string | null>(initialConfig?.logoR2Key ?? null);
  const [logoType, setLogoType] = useState<string | null>(initialConfig?.logoContentType ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setErrors({});

    const res = await fetch("/api/workshop-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    if (res.status === 400) {
      const body = await res.json();
      setErrors(body.errors ?? {});
      setStatus("idle");
      return;
    }

    if (!res.ok) {
      setErrors({ form: "No se pudo guardar la configuración." });
      setStatus("idle");
      return;
    }

    setStatus("saved");
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <LogoUploadField currentKey={logoKey} currentType={logoType} onUpdate={(k, t) => { setLogoKey(k); setLogoType(t); }} />

          <div className="grid gap-2">
            <Label htmlFor="name">Nombre del taller</Label>
            <Input id="name" value={name} onChange={(e) => { setName(e.target.value); setStatus("idle"); }} maxLength={100} />
          </div>
          {errors.name && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.name}
            </p>
          )}

          {errors.form && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.form}
            </p>
          )}

          <Button type="submit" disabled={status === "saving"} className="self-start">
            {status === "saving" ? "Guardando…" : "Guardar"}
          </Button>
          {status === "saved" && <p className="text-sm text-green-600">Configuración guardada.</p>}
        </form>
      </CardContent>
    </Card>
  );
}
