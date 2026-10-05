"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FIELD_ERROR } from "@/shared/ui/styles";

type Props = {
  currentKey: string | null;
  currentType: string | null;
  onUpdate: (key: string | null, contentType: string | null) => void;
  /** WU5 (design D6, task 6.6) — parametrized so the same upload UI serves
   * both the logo (`/api/workshop-config/logo`) and the per-template cover
   * image (`/api/template-config/cover-image/<id>`).
   * Defaults preserve the pre-WU5 logo behaviour unchanged. */
  label?: string;
  endpoint?: string;
  helpText?: string;
  /** Logos may be vector; a photo (the per-template cover) may not. */
  allowSvg?: boolean;
};

export function LogoUploadField({
  currentKey,
  currentType,
  onUpdate,
  label = "Logo del taller",
  endpoint = "/api/workshop-config/logo",
  allowSvg = true,
  helpText = "El logo se guarda inmediatamente al subirlo. Formatos: PNG, JPEG, WebP o SVG (máx. 2MB, SVG: 512KB).",
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(() => {
    if (currentKey) return `${endpoint}?v=${currentKey}`;
    return null;
  });
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setUploading(true);

    const form = new FormData();
    form.append("file", file);

    const res = await fetch(endpoint, { method: "POST", body: form });

    if (!res.ok) {
      setError(`No se pudo subir la imagen. Verifica que sea una imagen válida (${allowSvg ? "PNG, JPEG, WebP o SVG" : "PNG, JPEG o WebP"}).`);
      setUploading(false);
      return;
    }

    const { key } = await res.json();
    onUpdate(key, file.type || "application/octet-stream");
    setPreview(`${endpoint}?v=${key}`);
    setUploading(false);
  }

  async function handleDelete() {
    setError(null);
    const res = await fetch(endpoint, { method: "DELETE" });
    if (!res.ok) {
      setError("No se pudo eliminar la imagen.");
      return;
    }
    onUpdate(null, null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={`image-upload-${endpoint}`}>{label}</Label>

      {preview && (
        <div className="relative mb-2 inline-block size-24 overflow-hidden rounded-lg border">
          <img src={preview} alt={`${label} preview`} className="size-full object-contain" />
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* The native control renders "Choose File / No file chosen" in the
            browser's language, not ours. It stays in the DOM (labelled, so a
            label click and a test upload still reach it) but is visually
            hidden and out of the tab order; the button below is what a
            person sees, and it opens the same picker. */}
        <Input
          id={`image-upload-${endpoint}`}
          ref={inputRef}
          type="file"
          accept={allowSvg ? "image/png,image/jpeg,image/webp,image/svg+xml" : "image/png,image/jpeg,image/webp"}
          onChange={handleFile}
          disabled={uploading}
          tabIndex={-1}
          className="sr-only"
        />
        <Button
          type="button"
          variant="outline"
          className="min-h-11 min-w-11"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {preview ? "Cambiar imagen" : "Elegir imagen"}
        </Button>

        {preview && (
          <Button type="button" variant="outline" size="sm" className="min-h-11 min-w-11" onClick={handleDelete} disabled={uploading}>
            Eliminar
          </Button>
        )}
      </div>

      {uploading && <p className="text-xs text-muted-foreground">Subiendo…</p>}

      <p className="text-xs text-muted-foreground">{helpText}</p>

      {error && (
        <p role="alert" className={FIELD_ERROR}>
          {error}
        </p>
      )}
    </div>
  );
}
