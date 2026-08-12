/**
 * Component tests for the gallery picker (catalog-templates-and-workshop-info
 * WU2 — additive, unwired). `template_config.logo_url/primary_colors/font/
 * cover_text` stay `NOT NULL` until migration `0009` (WU3), so the gallery
 * EXTENDS the existing branding form rather than replacing it — the branding
 * inputs stay so `saveTemplateConfig` keeps a value to persist into those
 * columns (design.md Risk #3). WU3 removes them once the columns are gone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DEFAULT_TEMPLATE_ID } from "@/shared/template/registry";
import { TemplateConfigForm } from "./TemplateConfigForm";

function mockFetch(response: { status: number; body?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.body ?? {},
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("TemplateConfigForm — gallery picker", () => {
  it("renders exactly the one registry entry, pre-selected as the default", () => {
    render(<TemplateConfigForm initialConfig={null} />);

    const radio = screen.getByRole("radio", { name: /Dforce Clásico/ });
    expect(radio).toBeChecked();
    expect(screen.getAllByRole("radio")).toHaveLength(1);
  });

  // Queries by id, not label text: the legacy branding inputs' English copy
  // is pre-existing and out of WU2's scope (WU3 deletes the inputs entirely
  // per task 3.12) — these tests must not pin that copy in place.
  it("still renders the legacy branding inputs (columns stay NOT NULL until WU3's migration 0009)", () => {
    const { container } = render(<TemplateConfigForm initialConfig={null} />);

    expect(container.querySelector("#logoUrl")).toBeInTheDocument();
    expect(container.querySelector("#font")).toBeInTheDocument();
  });

  // The registry has exactly one entry (spec: "Single-entry gallery") and a
  // second is explicitly out of this change's scope (proposal.md: "A second
  // template is an additive PR"), so this test cannot exercise an actual
  // selection *change* — clicking the one pre-selected radio fires no
  // onChange. It proves `toFormState`'s default resolution reaches the POST
  // body on submit, not that switching selection works. Spec scenario
  // "Selecting a template" stays unverified until a second template exists.
  it("includes the default-resolved selectedTemplateId in the POST body on submit", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { config: { id: "singleton" } } });
    const { container } = render(<TemplateConfigForm initialConfig={null} />);

    await user.type(container.querySelector("#logoUrl") as HTMLElement, "https://example.com/logo.png");
    await user.type(container.querySelector("#font") as HTMLElement, "Arial, sans-serif");
    await user.type(container.querySelector("#coverText") as HTMLElement, "Catalogo 2026");
    // Queries by type, not the pre-existing "Save" label text — the button
    // survives WU3 (only the branding inputs are deleted), but nothing
    // guarantees its English copy does, and this test must not pin it.
    await user.click(container.querySelector('button[type="submit"]') as HTMLElement);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock).selectedTemplateId).toBe(DEFAULT_TEMPLATE_ID);
  });
});
