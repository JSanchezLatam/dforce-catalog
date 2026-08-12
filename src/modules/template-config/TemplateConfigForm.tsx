"use client";

import { useState, type FormEvent } from "react";

import type { TemplateConfig } from "@/shared/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FIELD_ERROR, SECTION_HEADING } from "@/shared/ui/styles";
import { CATALOG_TEMPLATES, getTemplate } from "@/shared/template/registry";

type FormState = {
  logoUrl: string;
  primary: string;
  secondary: string;
  font: string;
  coverText: string;
  defaultImageHandling: "strict" | "adaptive";
  selectedTemplateId: string;
};

function toFormState(config: TemplateConfig | null): FormState {
  return {
    logoUrl: config?.logoUrl ?? "",
    primary: config?.primaryColors.primary ?? "#000000",
    secondary: config?.primaryColors.secondary ?? "#ffffff",
    font: config?.font ?? "",
    coverText: config?.coverText ?? "",
    defaultImageHandling: config?.defaultImageHandling === "adaptive" ? "adaptive" : "strict",
    selectedTemplateId: getTemplate(config?.selectedTemplateId).id,
  };
}

/**
 * R8.3 — live preview before confirm. The preview below reflects `form`
 * state on every keystroke; nothing is persisted until the admin submits,
 * at which point the same `template.edit`-gated route (`/api/template-config`)
 * validates and saves it.
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
        logoUrl: form.logoUrl,
        primaryColors: { primary: form.primary, secondary: form.secondary },
        font: form.font,
        coverText: form.coverText,
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
      setErrors({ form: "Could not save the template. Try again." });
      setStatus("idle");
      return;
    }

    setStatus("saved");
  }

  return (
    // PR11a — single page-level dash-card wraps form + preview together,
    // matching the one-card-per-content-block treatment established for
    // /inventory's filters+table (PR10) rather than PR5a's two separate
    // nested cards; a border-dash-border divider (already used by INPUT)
    // separates the preview from the form instead of a second card.
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/*
            Gallery picker (catalog-templates-and-workshop-info WU2, additive
            and unwired — nothing reads `selectedTemplateId` yet). EXTENDS the
            branding form below rather than replacing it: `template_config`'s
            logo/color/font/cover-text columns stay NOT NULL until WU3's
            migration 0009 drops them, so `saveTemplateConfig` still needs
            those inputs. WU3 removes them once the columns are gone.
          */}
          <div className="grid gap-2">
            <Label id="template-gallery-heading" className={SECTION_HEADING}>
              Plantilla del catálogo
            </Label>
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
            <Label htmlFor="logoUrl">Logo URL</Label>
            <Input id="logoUrl" value={form.logoUrl} onChange={(e) => update("logoUrl", e.target.value)} />
          </div>
          {errors.logoUrl && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.logoUrl}
            </p>
          )}

          <div className="grid gap-2">
            <Label htmlFor="primary">Primary color</Label>
            <Input
              id="primary"
              type="color"
              className="h-10 w-16"
              value={form.primary}
              onChange={(e) => update("primary", e.target.value)}
            />
          </div>
          {errors.primaryColor && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.primaryColor}
            </p>
          )}

          <div className="grid gap-2">
            <Label htmlFor="secondary">Secondary color</Label>
            <Input
              id="secondary"
              type="color"
              className="h-10 w-16"
              value={form.secondary}
              onChange={(e) => update("secondary", e.target.value)}
            />
          </div>
          {errors.secondaryColor && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.secondaryColor}
            </p>
          )}

          <div className="grid gap-2">
            <Label htmlFor="font">Typography</Label>
            <Input
              id="font"
              value={form.font}
              onChange={(e) => update("font", e.target.value)}
              placeholder="e.g. Arial, sans-serif"
            />
          </div>
          {errors.font && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.font}
            </p>
          )}

          <div className="grid gap-2">
            <Label htmlFor="coverText">Cover text</Label>
            <textarea
              id="coverText"
              className="flex min-h-[60px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
              rows={3}
              value={form.coverText}
              onChange={(e) => update("coverText", e.target.value)}
            />
          </div>
          {errors.coverText && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.coverText}
            </p>
          )}

          <div className="grid gap-2">
            <Label htmlFor="defaultImageHandling">Image handling</Label>
            <Select
              value={form.defaultImageHandling}
              onValueChange={(v) => update("defaultImageHandling", v as "strict" | "adaptive")}
            >
              <SelectTrigger id="defaultImageHandling" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="strict">Strict (all products framed)</SelectItem>
                <SelectItem value="adaptive">Adaptive (per-image layout)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {errors.form && (
            <p role="alert" className={FIELD_ERROR}>
              {errors.form}
            </p>
          )}

          <Button type="submit" disabled={status === "saving"} className="self-start">
            {status === "saving" ? "Saving…" : "Save"}
          </Button>
          {status === "saved" && <p className="text-sm text-green-600">Saved. New catalogs will use this template.</p>}
        </form>
      </CardContent>

      <CardContent>
        <section
          aria-label="Template preview"
          className="border-t border-border pt-6"
          style={{ fontFamily: form.font || undefined, color: form.primary }}
        >
          <h2 className={SECTION_HEADING}>Preview</h2>
          {form.logoUrl && <img src={form.logoUrl} alt="Logo preview" style={{ maxHeight: 80 }} />}
          <div
            style={{
              background: form.secondary,
              color: form.primary,
              padding: "1rem",
              border: `2px solid ${form.primary}`,
            }}
          >
            <p>{form.coverText || "Cover text preview"}</p>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
