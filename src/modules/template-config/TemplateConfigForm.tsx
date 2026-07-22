"use client";

import { useState, type FormEvent } from "react";

import type { TemplateConfig } from "@/shared/db/schema";

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
    <div>
      <form onSubmit={handleSubmit}>
        <label>
          Logo URL
          <input value={form.logoUrl} onChange={(e) => update("logoUrl", e.target.value)} />
        </label>
        {errors.logoUrl && <p role="alert">{errors.logoUrl}</p>}

        <label>
          Primary color
          <input type="color" value={form.primary} onChange={(e) => update("primary", e.target.value)} />
        </label>
        {errors.primaryColor && <p role="alert">{errors.primaryColor}</p>}

        <label>
          Secondary color
          <input type="color" value={form.secondary} onChange={(e) => update("secondary", e.target.value)} />
        </label>
        {errors.secondaryColor && <p role="alert">{errors.secondaryColor}</p>}

        <label>
          Typography
          <input value={form.font} onChange={(e) => update("font", e.target.value)} placeholder="e.g. Arial, sans-serif" />
        </label>
        {errors.font && <p role="alert">{errors.font}</p>}

        <label>
          Cover text
          <textarea value={form.coverText} onChange={(e) => update("coverText", e.target.value)} />
        </label>
        {errors.coverText && <p role="alert">{errors.coverText}</p>}

        {errors.form && <p role="alert">{errors.form}</p>}

        <button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save"}
        </button>
        {status === "saved" && <p>Saved. New catalogs will use this template.</p>}
      </form>

      {/* R8.3 — preview reflects unsaved `form` state, not the persisted config. */}
      <section aria-label="Template preview" style={{ fontFamily: form.font || undefined, color: form.primary }}>
        <h2>Preview</h2>
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
