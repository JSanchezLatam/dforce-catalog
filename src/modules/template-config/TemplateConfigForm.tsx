"use client";

import { useState, type FormEvent } from "react";

import type { TemplateConfig, WorkshopConfig } from "@/shared/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CARD, FIELD_ERROR, SECTION_HEADING } from "@/shared/ui/styles";
import { CatalogTemplate } from "@/shared/template/CatalogTemplate";
import { CATALOG_TEMPLATES, getTemplate } from "@/shared/template/registry";
import { buildWorkshopContact } from "@/modules/workshop-config/contact";

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
 * The title the preview's cover and index carry. A catalog's real title is
 * derived from the selection that produced it (`deriveCatalogTitle`), which
 * this screen has none of — so it says what it is. Spanish, like everything
 * printed on the sheet.
 */
const PREVIEW_TITLE = "Catálogo de productos";

/**
 * `zoom`, not `transform: scale`, and the difference is the whole point: a
 * transform scales PAINT only, so the sheet would still reserve its full
 * 816 x 1056 px of layout and go on burying the controls underneath —
 * exactly the defect that moved it off the builder. `zoom` scales the layout
 * box with it, so the card is the size of what you see. One factor, so the
 * paper's aspect ratio cannot drift.
 *
 * ponytail: a fixed factor, not a measured fit — 816 * 0.6 = 490px, which
 * clears the content column on a laptop and a landscape tablet, and the
 * wrapper scrolls rather than overflowing anywhere narrower. Measure the
 * container (ResizeObserver) only if a real screen shows this is wrong.
 * Firefox below 126 ignores `zoom` and shows the sheet full size; the
 * workshop runs Chrome/Edge.
 */
const PREVIEW_ZOOM = 0.6;

/**
 * catalog-templates-and-workshop-info WU3 (task 3.12, migration `0009`) —
 * the logo/colour/font/cover-text inputs that used to live here are gone:
 * font and colours are template-fixed (the registry, shown via the gallery
 * swatch below), and logo/cover-text are workshop-owned
 * (`/workshop-config`). This form picks a template and the per-generation
 * image-handling mode.
 *
 * workshop-feedback-round-1 PR F1 — and it shows the preview, which is what
 * makes that choice legible. It renders the SAME `CatalogTemplate` the PDF
 * worker does (Risk-5: one renderer or the two drift), against the form's
 * unsaved state, so it answers "what am I about to save" rather than "what
 * did I save". It carries no `productPages` — a product needs a selection,
 * which belongs to the builder — so it shows exactly the three sheets this
 * screen governs: cover, index and contact.
 */
export function TemplateConfigForm({
  initialConfig,
  workshopConfig,
}: {
  initialConfig: TemplateConfig | null;
  /**
   * Branding the preview must show but this form does NOT edit — the logo,
   * cover photo, cover text and contact block all belong to
   * `/workshop-config`. Read-only here, and the reason the preview looks
   * like the workshop's catalog instead of a blank template.
   */
  workshopConfig: WorkshopConfig | null;
}) {
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
    <div className="flex flex-col gap-6">
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

      <Card size="sm">
        <CardContent>
          <section aria-label="Vista previa">
            <h2 className={SECTION_HEADING}>Vista previa</h2>
            <div className={`${CARD} max-h-[70vh] overflow-auto`}>
              <div data-preview-scale style={{ zoom: PREVIEW_ZOOM }}>
                <CatalogTemplate
                  title={PREVIEW_TITLE}
                  // No selection exists on this screen, so the index has no
                  // categories to list and says so (CatalogTemplate prints
                  // "No hay categorías seleccionadas."). Inventing sample rows
                  // would make the one sheet that is DATA look like branding.
                  sections={[]}
                  branding={{
                    // The form's state, not `initialConfig`: the point of the
                    // preview is the template you just clicked.
                    templateId: getTemplate(form.selectedTemplateId).id,
                    // The logo route is session-authenticated (the browser
                    // sends its cookie) — only supply the URL when a logo
                    // actually exists, so an unset logo renders no <img>
                    // instead of a broken one (matches the worker's per-key
                    // null handling). The worker cannot use this route at all
                    // and inlines the same R2 bytes as a data URI, which is
                    // what keeps the PDF pixel-identical to what is on screen
                    // here (specs/workshop-settings "Workshop Logo as Single
                    // Source for Branding").
                    logoUrl: workshopConfig?.logoR2Key ? "/api/workshop-config/logo" : null,
                    coverText: workshopConfig?.coverText ?? null,
                    // Same gating, mirroring the cover-image route.
                    coverImageUrl: workshopConfig?.coverImageR2Key ? "/api/workshop-config/cover-image" : null,
                    // The one shared mapping `generate/route.ts` also uses, so
                    // the contact page here is the contact page printed.
                    contact: buildWorkshopContact(workshopConfig ?? null),
                  }}
                  // `defaultImageHandling` is deliberately NOT passed: it only
                  // ever changes a PRODUCT card, and this preview has no
                  // products to show one on. Threading it would look like the
                  // preview answers a question it cannot answer.
                />
              </div>
            </div>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
