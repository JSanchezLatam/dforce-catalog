/**
 * Component tests for the template-config form after
 * catalog-templates-and-workshop-info WU3 (task 3.12, migration `0009`):
 * the legacy logo/color/font/cover-text inputs are gone — font/colours are
 * template-fixed (the registry) and logo/cover-text are workshop-owned. This
 * form now only picks a template and the image-handling mode.
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

  // The legacy branding inputs (logo URL, colors, typography, cover text)
  // no longer exist — font/colours are template-fixed and logo/cover-text
  // moved to workshop-config, per task 3.12.
  it("no longer renders the legacy branding inputs", () => {
    const { container } = render(<TemplateConfigForm initialConfig={null} />);

    expect(container.querySelector("#logoUrl")).not.toBeInTheDocument();
    expect(container.querySelector("#font")).not.toBeInTheDocument();
    expect(container.querySelector("#coverText")).not.toBeInTheDocument();
  });

  it("renders the image-handling select and the Spanish submit button", () => {
    render(<TemplateConfigForm initialConfig={null} />);

    expect(screen.getByText("Manejo de imágenes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
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
    render(<TemplateConfigForm initialConfig={null} />);

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock)).toEqual({ defaultImageHandling: "strict", selectedTemplateId: DEFAULT_TEMPLATE_ID });
  });

  it("shows the Spanish saved confirmation after a successful submit", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 200, body: { config: { id: "singleton" } } });
    render(<TemplateConfigForm initialConfig={null} />);

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText(/Guardado\. Los nuevos catálogos usarán esta plantilla\./)).toBeInTheDocument();
  });
});
