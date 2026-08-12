"use client";

import { useState, type FormEvent } from "react";

import type { WorkshopConfig } from "@/shared/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FIELD_ERROR, SECTION_HEADING } from "@/shared/ui/styles";
import { LogoUploadField } from "./LogoUploadField";

type Props = {
  initialConfig: WorkshopConfig | null;
};

const TEXTAREA_CLASS =
  "flex min-h-[60px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30";

type SocialHandleRow = { platform: string; handle: string };

function toSocialRows(socialHandles: Record<string, string> | null | undefined): SocialHandleRow[] {
  if (!socialHandles) return [];
  return Object.entries(socialHandles).map(([platform, handle]) => ({ platform, handle }));
}

export function WorkshopConfigForm({ initialConfig }: Props) {
  const [name, setName] = useState(initialConfig?.name ?? "");
  const [logoKey, setLogoKey] = useState<string | null>(initialConfig?.logoR2Key ?? null);
  const [logoType, setLogoType] = useState<string | null>(initialConfig?.logoContentType ?? null);
  const [phone, setPhone] = useState(initialConfig?.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(initialConfig?.whatsapp ?? "");
  const [email, setEmail] = useState(initialConfig?.email ?? "");
  const [address, setAddress] = useState(initialConfig?.address ?? "");
  const [hours, setHours] = useState(initialConfig?.hours ?? "");
  const [website, setWebsite] = useState(initialConfig?.website ?? "");
  const [coverText, setCoverText] = useState(initialConfig?.coverText ?? "");
  const [socialRows, setSocialRows] = useState<SocialHandleRow[]>(() => toSocialRows(initialConfig?.socialHandles));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  function updateSocialRow(index: number, field: keyof SocialHandleRow, value: string) {
    setSocialRows((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
    setStatus("idle");
  }

  function removeSocialRow(index: number) {
    setSocialRows((rows) => rows.filter((_, i) => i !== index));
    setStatus("idle");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setErrors({});

    const socialHandles: Record<string, string> = {};
    for (const row of socialRows) {
      if (row.platform.trim()) socialHandles[row.platform.trim()] = row.handle;
    }

    const res = await fetch("/api/workshop-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, whatsapp, email, address, hours, website, coverText, socialHandles }),
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

          <h2 className={SECTION_HEADING}>Información de contacto</h2>

          <div className="grid gap-2">
            <Label htmlFor="phone">Teléfono</Label>
            <Input id="phone" value={phone} onChange={(e) => { setPhone(e.target.value); setStatus("idle"); }} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="whatsapp">WhatsApp</Label>
            <Input id="whatsapp" value={whatsapp} onChange={(e) => { setWhatsapp(e.target.value); setStatus("idle"); }} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setStatus("idle"); }} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="address">Dirección</Label>
            <Input id="address" value={address} onChange={(e) => { setAddress(e.target.value); setStatus("idle"); }} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="hours">Horario</Label>
            <textarea
              id="hours"
              className={TEXTAREA_CLASS}
              rows={2}
              placeholder="Ej. Lun-Vie 9-18, Sáb 9-13"
              value={hours}
              onChange={(e) => { setHours(e.target.value); setStatus("idle"); }}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="website">Sitio web</Label>
            <Input id="website" value={website} onChange={(e) => { setWebsite(e.target.value); setStatus("idle"); }} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="coverText">Texto de portada</Label>
            <textarea
              id="coverText"
              className={TEXTAREA_CLASS}
              rows={3}
              value={coverText}
              onChange={(e) => { setCoverText(e.target.value); setStatus("idle"); }}
            />
          </div>

          <h2 className={SECTION_HEADING}>Redes sociales</h2>
          <div className="flex flex-col gap-3">
            {socialRows.map((row, index) => (
              <div key={index} className="flex items-end gap-2">
                <div className="grid flex-1 gap-2">
                  <Label htmlFor={`social-platform-${index}`}>Plataforma</Label>
                  <Input
                    id={`social-platform-${index}`}
                    value={row.platform}
                    onChange={(e) => updateSocialRow(index, "platform", e.target.value)}
                  />
                </div>
                <div className="grid flex-1 gap-2">
                  <Label htmlFor={`social-handle-${index}`}>Usuario o enlace</Label>
                  <Input
                    id={`social-handle-${index}`}
                    value={row.handle}
                    onChange={(e) => updateSocialRow(index, "handle", e.target.value)}
                  />
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => removeSocialRow(index)}>
                  Eliminar
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setSocialRows((rows) => [...rows, { platform: "", handle: "" }])}
            >
              Agregar red social
            </Button>
          </div>

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
