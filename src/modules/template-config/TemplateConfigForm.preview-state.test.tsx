/**
 * workshop-feedback-round-1 PR F1 — the one property of the moved preview that
 * the main test file cannot prove: the preview renders the form's CURRENT
 * state, not the saved config. A preview of what is already saved is a
 * screenshot, not a preview.
 *
 * Why this lives in its own file: the shipped registry has exactly ONE
 * template (`registry.ts`, and "a second template is an additive PR"), so with
 * the real registry there is no selection change to make — clicking the single
 * pre-checked radio fires no `onChange`, which is the same wall documented in
 * `TemplateConfigForm.test.tsx`. Mocking the registry to hold two entries is
 * what makes the choice expressible, and `vi.mock` is file-scoped, so doing it
 * here leaves the one-entry assertions in that file alone.
 *
 * The mock adds an entry; it does not reshape the contract. `CatalogTemplate`
 * resolves the same `getTemplate` from the same module, so the font asserted
 * below travels the real path: radio -> form state -> `branding.templateId` ->
 * `getTemplate` -> the rendered `<article>`.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// `vi.hoisted`, because `vi.mock`'s factory is hoisted above every top-level
// binding in this file and would otherwise read this before initialization.
const ALT_FONT = vi.hoisted(() => '"Alt Preview Font", sans-serif');

vi.mock("@/shared/template/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/template/registry")>();
  const [classic] = actual.CATALOG_TEMPLATES;
  const alternate = { ...classic, id: "alt-template", name: "Alterna", font: ALT_FONT };
  const templates = [classic, alternate];

  return {
    ...actual,
    CATALOG_TEMPLATES: templates,
    getTemplate: (id?: string | null) => templates.find((template) => template.id === id) ?? classic,
  };
});

import { TemplateConfigForm } from "./TemplateConfigForm";

const previewFont = () => document.querySelector("article")!.style.fontFamily;

describe("TemplateConfigForm — the preview shows what you are about to save (PR F1)", () => {
  it("re-renders the preview with the template just picked, before any save", async () => {
    const user = userEvent.setup();
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} />);

    const before = previewFont();
    expect(before).not.toBe("");

    await user.click(screen.getByRole("radio", { name: /Alterna/ }));

    expect(previewFont()).toBe(ALT_FONT);
    expect(previewFont()).not.toBe(before);
  });

  it("starts from the SAVED template on first paint, so an unsaved screen is not a lie either", () => {
    render(
      <TemplateConfigForm
        initialConfig={{ id: "singleton", selectedTemplateId: "alt-template", defaultImageHandling: "strict", updatedAt: new Date() }}
        workshopConfig={null}
      />,
    );

    expect(previewFont()).toBe(ALT_FONT);
  });
});
