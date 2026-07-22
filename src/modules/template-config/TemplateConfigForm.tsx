"use client";

import { useState, type FormEvent } from "react";

import type { TemplateConfig } from "@/shared/db/schema";
import { CARD, FIELD_ERROR, INPUT, LABEL, PRIMARY_BUTTON, SECTION_HEADING } from "@/shared/ui/styles";

type FormState = {
  logoUrl: string;
  primary: string;
  secondary: string;
  font: string;
  coverText: string;
};

function toFormState(config: TemplateConfig | null): FormState {
  return {
    logoUrl: config?.logoUrl ?? "",
    primary: config?.primaryColors.primary ?? "#000000",
    secondary: config?.primaryColors.secondary ?? "#ffffff",
    font: config?.font ?? "",
    coverText: config?.coverText ?? "",
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
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className={`flex flex-col gap-4 ${CARD}`}>
        <label className={LABEL}>
          Logo URL
          <input className={`mt-1 ${INPUT}`} value={form.logoUrl} onChange={(e) => update("logoUrl", e.target.value)} />
        </label>
        {errors.logoUrl && (
          <p role="alert" className={FIELD_ERROR}>
            {errors.logoUrl}
          </p>
        )}

        <label className={LABEL}>
          Primary color
          <input
            type="color"
            className="mt-1 h-10 w-16 rounded border border-dash-muted bg-dash-bg"
            value={form.primary}
            onChange={(e) => update("primary", e.target.value)}
          />
        </label>
        {errors.primaryColor && (
          <p role="alert" className={FIELD_ERROR}>
            {errors.primaryColor}
          </p>
        )}

        <label className={LABEL}>
          Secondary color
          <input
            type="color"
            className="mt-1 h-10 w-16 rounded border border-dash-muted bg-dash-bg"
            value={form.secondary}
            onChange={(e) => update("secondary", e.target.value)}
          />
        </label>
        {errors.secondaryColor && (
          <p role="alert" className={FIELD_ERROR}>
            {errors.secondaryColor}
          </p>
        )}

        <label className={LABEL}>
          Typography
          <input
            className={`mt-1 ${INPUT}`}
            value={form.font}
            onChange={(e) => update("font", e.target.value)}
            placeholder="e.g. Arial, sans-serif"
          />
        </label>
        {errors.font && (
          <p role="alert" className={FIELD_ERROR}>
            {errors.font}
          </p>
        )}

        <label className={LABEL}>
          Cover text
          <textarea className={`mt-1 ${INPUT}`} rows={3} value={form.coverText} onChange={(e) => update("coverText", e.target.value)} />
        </label>
        {errors.coverText && (
          <p role="alert" className={FIELD_ERROR}>
            {errors.coverText}
          </p>
        )}

        {errors.form && (
          <p role="alert" className={FIELD_ERROR}>
            {errors.form}
          </p>
        )}

        <button type="submit" disabled={status === "saving"} className={`self-start ${PRIMARY_BUTTON}`}>
          {status === "saving" ? "Saving…" : "Save"}
        </button>
        {status === "saved" && <p className="text-sm text-dash-green">Saved. New catalogs will use this template.</p>}
      </form>

      {/* R8.3 — preview reflects unsaved `form` state, not the persisted config. */}
      <section
        aria-label="Template preview"
        className={CARD}
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
    </div>
  );
}
