"use client";

import { useRef, useState, type FormEvent } from "react";

import type { WorkshopConfig } from "@/shared/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FIELD_ERROR, SECTION_HEADING } from "@/shared/ui/styles";
import { LogoUploadField } from "./LogoUploadField";
import { MAX_CONTACT_FIELD_LENGTH, MAX_COVER_TEXT_LENGTH, MAX_HANDLE_ENTRIES, MAX_HANDLE_LENGTH, MAX_NAME_LENGTH } from "./limits";

type Props = {
  initialConfig: WorkshopConfig | null;
};

const TEXTAREA_CLASS =
  "flex min-h-[60px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30";

/** `id` is a stable per-row key independent of array position — rows are removable, and an
 * index-based key would let React reuse a deleted row's DOM node (and its focus/cursor state)
 * for the next row that shifts into its slot. */
type SocialHandleRow = { id: number; platform: string; handle: string };

function toSocialRows(socialHandles: Record<string, string> | null | undefined): SocialHandleRow[] {
  if (!socialHandles) return [];
  return Object.entries(socialHandles).map(([platform, handle], id) => ({ id, platform, handle }));
}

const TEXT_FIELD_KEYS = ["name", "phone", "whatsapp", "email", "address", "hours", "website", "coverText"] as const;

/**
 * A snapshot of every field this form owns, taken once at load. `socialHandles`
 * is pre-stringified so it can be diffed with `!==` like every other field.
 */
function snapshotFrom(config: WorkshopConfig | null): Record<(typeof TEXT_FIELD_KEYS)[number] | "socialHandles", string> {
  return {
    name: config?.name ?? "",
    phone: config?.phone ?? "",
    whatsapp: config?.whatsapp ?? "",
    email: config?.email ?? "",
    address: config?.address ?? "",
    hours: config?.hours ?? "",
    website: config?.website ?? "",
    coverText: config?.coverText ?? "",
    socialHandles: JSON.stringify(config?.socialHandles ?? {}),
  };
}

export function WorkshopConfigForm({ initialConfig }: Props) {
  const [name, setName] = useState(initialConfig?.name ?? "");
  const [logoKey, setLogoKey] = useState<string | null>(initialConfig?.logoR2Key ?? null);
  const [logoType, setLogoType] = useState<string | null>(initialConfig?.logoContentType ?? null);
  const [coverImageKey, setCoverImageKey] = useState<string | null>(initialConfig?.coverImageR2Key ?? null);
  const [coverImageType, setCoverImageType] = useState<string | null>(initialConfig?.coverImageContentType ?? null);
  const [phone, setPhone] = useState(initialConfig?.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(initialConfig?.whatsapp ?? "");
  const [email, setEmail] = useState(initialConfig?.email ?? "");
  const [address, setAddress] = useState(initialConfig?.address ?? "");
  const [hours, setHours] = useState(initialConfig?.hours ?? "");
  const [website, setWebsite] = useState(initialConfig?.website ?? "");
  const [coverText, setCoverText] = useState(initialConfig?.coverText ?? "");
  const [socialRows, setSocialRows] = useState<SocialHandleRow[]>(() => toSocialRows(initialConfig?.socialHandles));
  const nextSocialRowId = useRef(socialRows.length);
  const savedSnapshot = useRef(snapshotFrom(initialConfig));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  function addSocialRow() {
    setSocialRows((rows) => [...rows, { id: nextSocialRowId.current++, platform: "", handle: "" }]);
    setStatus("idle");
  }

  function updateSocialRow(id: number, field: "platform" | "handle", value: string) {
    setSocialRows((rows) => rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setStatus("idle");
  }

  function removeSocialRow(id: number) {
    setSocialRows((rows) => rows.filter((row) => row.id !== id));
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

    // Only send fields that actually changed since load/last save — this
    // form owns the whole contact block and would otherwise resend every
    // field on every submit, including ones the admin never touched this
    // session. A save from a stale tab (loaded before some OTHER field was
    // set elsewhere) would then silently revert it. Matches UserForm.tsx's
    // existing "omit unchanged optional fields" precedent.
    const current: Record<(typeof TEXT_FIELD_KEYS)[number], string> = {
      name,
      phone,
      whatsapp,
      email,
      address,
      hours,
      website,
      coverText,
    };
    const body: Record<string, unknown> = {};
    for (const key of TEXT_FIELD_KEYS) {
      if (current[key] !== savedSnapshot.current[key]) body[key] = current[key];
    }
    const socialHandlesJson = JSON.stringify(socialHandles);
    if (socialHandlesJson !== savedSnapshot.current.socialHandles) body.socialHandles = socialHandles;

    const res = await fetch("/api/workshop-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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

    savedSnapshot.current = { ...current, socialHandles: socialHandlesJson };
    setStatus("saved");
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <LogoUploadField currentKey={logoKey} currentType={logoType} onUpdate={(k, t) => { setLogoKey(k); setLogoType(t); }} />
          <LogoUploadField
            currentKey={coverImageKey}
            currentType={coverImageType}
            onUpdate={(k, t) => { setCoverImageKey(k); setCoverImageType(t); }}
            label="Imagen de portada"
            endpoint="/api/workshop-config/cover-image"
            helpText="La foto de portada se guarda inmediatamente al subirla. Formatos: PNG, JPEG, WebP o SVG (máx. 2MB, SVG: 512KB)."
          />

          <div className="grid gap-2">
            <Label htmlFor="name">Nombre del taller</Label>
            <Input id="name" value={name} onChange={(e) => { setName(e.target.value); setStatus("idle"); }} maxLength={MAX_NAME_LENGTH} />
          </div>
          {errors.name && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.name}
            </p>
          )}

          <h2 className={SECTION_HEADING}>Información de contacto</h2>

          <div className="grid gap-2">
            <Label htmlFor="phone">Teléfono</Label>
            <Input
              id="phone"
              value={phone}
              maxLength={MAX_CONTACT_FIELD_LENGTH}
              onChange={(e) => { setPhone(e.target.value); setStatus("idle"); }}
            />
          </div>
          {errors.phone && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.phone}
            </p>
          )}

          <div className="grid gap-2">
            <Label htmlFor="whatsapp">WhatsApp</Label>
            <Input
              id="whatsapp"
              value={whatsapp}
              maxLength={MAX_CONTACT_FIELD_LENGTH}
              onChange={(e) => { setWhatsapp(e.target.value); setStatus("idle"); }}
            />
          </div>
          {errors.whatsapp && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.whatsapp}
            </p>
          )}

          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              maxLength={MAX_CONTACT_FIELD_LENGTH}
              onChange={(e) => { setEmail(e.target.value); setStatus("idle"); }}
            />
          </div>
          {errors.email && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.email}
            </p>
          )}

          <div className="grid gap-2">
            <Label htmlFor="address">Dirección</Label>
            <Input
              id="address"
              value={address}
              maxLength={MAX_CONTACT_FIELD_LENGTH}
              onChange={(e) => { setAddress(e.target.value); setStatus("idle"); }}
            />
          </div>
          {errors.address && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.address}
            </p>
          )}

          <div className="grid gap-2">
            <Label htmlFor="hours">Horario</Label>
            <textarea
              id="hours"
              className={TEXTAREA_CLASS}
              rows={2}
              maxLength={MAX_CONTACT_FIELD_LENGTH}
              placeholder="Ej. Lun-Vie 9-18, Sáb 9-13"
              value={hours}
              onChange={(e) => { setHours(e.target.value); setStatus("idle"); }}
            />
          </div>
          {errors.hours && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.hours}
            </p>
          )}

          <div className="grid gap-2">
            <Label htmlFor="website">Sitio web</Label>
            <Input
              id="website"
              value={website}
              maxLength={MAX_CONTACT_FIELD_LENGTH}
              onChange={(e) => { setWebsite(e.target.value); setStatus("idle"); }}
            />
          </div>
          {errors.website && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.website}
            </p>
          )}

          <div className="grid gap-2">
            <Label htmlFor="coverText">Texto de portada</Label>
            <textarea
              id="coverText"
              className={TEXTAREA_CLASS}
              rows={3}
              maxLength={MAX_COVER_TEXT_LENGTH}
              value={coverText}
              onChange={(e) => { setCoverText(e.target.value); setStatus("idle"); }}
            />
          </div>
          {errors.coverText && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.coverText}
            </p>
          )}

          <h2 className={SECTION_HEADING}>Redes sociales</h2>
          <div className="flex flex-col gap-3">
            {socialRows.map((row) => (
              <div key={row.id} className="flex items-end gap-2">
                <div className="grid flex-1 gap-2">
                  <Label htmlFor={`social-platform-${row.id}`}>Plataforma</Label>
                  <Input
                    id={`social-platform-${row.id}`}
                    value={row.platform}
                    maxLength={MAX_HANDLE_LENGTH}
                    onChange={(e) => updateSocialRow(row.id, "platform", e.target.value)}
                  />
                </div>
                <div className="grid flex-1 gap-2">
                  <Label htmlFor={`social-handle-${row.id}`}>Usuario o enlace</Label>
                  <Input
                    id={`social-handle-${row.id}`}
                    value={row.handle}
                    maxLength={MAX_HANDLE_LENGTH}
                    onChange={(e) => updateSocialRow(row.id, "handle", e.target.value)}
                  />
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => removeSocialRow(row.id)}>
                  Eliminar
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={socialRows.length >= MAX_HANDLE_ENTRIES}
              onClick={addSocialRow}
            >
              Agregar red social
            </Button>
          </div>
          {errors.socialHandles && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.socialHandles}
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
