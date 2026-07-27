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
};

export function LogoUploadField({ currentKey, currentType, onUpdate }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(() => {
    if (currentKey) return `/api/workshop-config/logo?v=${currentKey}`;
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

    const res = await fetch("/api/workshop-config/logo", { method: "POST", body: form });

    if (!res.ok) {
      setError("No se pudo subir el logo. Verifica que sea una imagen válida (PNG, JPEG, WebP o SVG).");
      setUploading(false);
      return;
    }

    const { key } = await res.json();
    onUpdate(key, file.type || "application/octet-stream");
    setPreview(`/api/workshop-config/logo?v=${key}`);
    setUploading(false);
  }

  async function handleDelete() {
    setError(null);
    const res = await fetch("/api/workshop-config/logo", { method: "DELETE" });
    if (!res.ok) {
      setError("No se pudo eliminar el logo.");
      return;
    }
    onUpdate(null, null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="grid gap-2">
      <Label>Logo del taller</Label>

      {preview && (
        <div className="relative mb-2 inline-block size-24 overflow-hidden rounded-lg border">
          <img src={preview} alt="Logo preview" className="size-full object-contain" />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={handleFile} disabled={uploading} className="max-w-64" />

        {preview && (
          <Button type="button" variant="outline" size="sm" onClick={handleDelete} disabled={uploading}>
            Eliminar
          </Button>
        )}
      </div>

      {uploading && <p className="text-xs text-muted-foreground">Subiendo logo…</p>}

      <p className="text-xs text-muted-foreground">
        El logo se guarda inmediatamente al subirlo. Formatos: PNG, JPEG, WebP o SVG (máx. 2MB, SVG: 512KB).
      </p>

      {error && (
        <p role="alert" className={FIELD_ERROR}>
          {error}
        </p>
      )}
    </div>
  );
}
