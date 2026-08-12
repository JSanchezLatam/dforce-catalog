"use client";

import { useState, type FormEvent } from "react";

import type { TemplateConfig } from "@/shared/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FIELD_ERROR, SECTION_HEADING } from "@/shared/ui/styles";
import { CATALOG_TEMPLATES, getTemplate } from "@/shared/template/registry";

type FormState = {
  defaultImageHandling: "strict" | "adaptive";
  selectedTemplateId: string;
};

function toFormState(config: TemplateConfig | null): FormState {
  return {
    defaultImageHandling: config?.defaultImageHandling === "adaptive" ? "adaptive" : "strict",
    selectedTemplateId: getTemplate(config?.selectedTemplateId).id,
  };
}

/**
 * catalog-templates-and-workshop-info WU3 (task 3.12, migration `0009`) —
 * the logo/colour/font/cover-text inputs that used to live here are gone:
 * font and colours are template-fixed (the registry, shown via the gallery
 * swatch below), and logo/cover-text are workshop-owned
 * (`/workshop-config`). This form now only picks a template and the
 * per-generation image-handling mode. The live full-catalog preview moved to
 * `CatalogBuilderForm` (Risk-5's shared `CatalogTemplate`), which is the
 * component that actually renders a generated catalog.
 */
export function TemplateConfigForm({ initialConfig }: { initialConfig: TemplateConfig | null }) {
  const [form, setForm] = useState<FormState>(() => toFormState(initialConfig));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setStatus("idle");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setErrors({});

    const response = await fetch("/api/template-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        defaultImageHandling: form.defaultImageHandling,
        selectedTemplateId: form.selectedTemplateId,
      }),
    });

    if (response.status === 400) {
      const body = await response.json();
      setErrors(body.errors ?? {});
      setStatus("idle");
      return;
    }

    if (!response.ok) {
      setErrors({ form: "No se pudo guardar la plantilla. Intentalo de nuevo." });
      setStatus("idle");
      return;
    }

    setStatus("saved");
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <h2 id="template-gallery-heading" className={SECTION_HEADING}>
              Plantilla del catálogo
            </h2>
            <div role="radiogroup" aria-labelledby="template-gallery-heading" className="flex flex-wrap gap-4">
              {CATALOG_TEMPLATES.map((template) => (
                <label
                  key={template.id}
                  className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-input p-3 has-[:checked]:border-ring"
                >
                  <input
                    type="radio"
                    name="selectedTemplateId"
                    value={template.id}
                    checked={form.selectedTemplateId === template.id}
                    onChange={() => update("selectedTemplateId", template.id)}
                  />
                  {/*
                    A real thumbnail asset (`template.thumbnail`, e.g.
                    "/templates/dforce-classic.png") does not exist yet — no
                    design tool produced one for this PR. A swatch avoids
                    shipping a broken <img>; swap it for a real thumbnail
                    once one exists.
                  */}
                  <div
                    aria-hidden="true"
                    style={{
                      width: 96,
                      height: 124,
                      background: template.primaryColors.secondary,
                      border: `2px solid ${template.primaryColors.primary}`,
                      borderRadius: 4,
                    }}
                  />
                  <span className="text-sm">{template.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="defaultImageHandling">Manejo de imágenes</Label>
            <Select
              value={form.defaultImageHandling}
              onValueChange={(v) => update("defaultImageHandling", v as "strict" | "adaptive")}
            >
              <SelectTrigger id="defaultImageHandling" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="strict">Estricto (todos los productos enmarcados)</SelectItem>
                <SelectItem value="adaptive">Adaptativo (diseño según cada imagen)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {errors.form && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.form}
            </p>
          )}

          <Button type="submit" disabled={status === "saving"} className="self-start">
            {status === "saving" ? "Guardando…" : "Guardar"}
          </Button>
          {status === "saved" && (
            <p className="text-sm text-green-600">Guardado. Los nuevos catálogos usarán esta plantilla.</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
