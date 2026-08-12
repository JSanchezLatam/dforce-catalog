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

  it("still renders the legacy branding inputs (columns stay NOT NULL until WU3's migration 0009)", () => {
    render(<TemplateConfigForm initialConfig={null} />);

    expect(screen.getByLabelText("Logo URL")).toBeInTheDocument();
    expect(screen.getByLabelText("Typography")).toBeInTheDocument();
  });

  it("submits the selected template id alongside the existing branding fields", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { config: { id: "singleton" } } });
    render(<TemplateConfigForm initialConfig={null} />);

    await user.type(screen.getByLabelText("Logo URL"), "https://example.com/logo.png");
    await user.type(screen.getByLabelText("Typography"), "Arial, sans-serif");
    await user.type(screen.getByLabelText("Cover text"), "Catalogo 2026");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock).selectedTemplateId).toBe(DEFAULT_TEMPLATE_ID);
  });
});
