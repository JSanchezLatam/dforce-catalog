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

import type { WorkshopConfig } from "@/shared/db/schema";
import { DEFAULT_TEMPLATE_ID } from "@/shared/template/registry";
import { TemplateConfigForm } from "./TemplateConfigForm";

function workshop(overrides: Partial<WorkshopConfig> = {}): WorkshopConfig {
  return {
    id: "singleton",
    name: "Dforce Car",
    logoR2Key: null,
    logoContentType: null,
    phone: "+507 6000-0000",
    whatsapp: null,
    email: null,
    address: null,
    hours: null,
    website: null,
    coverText: null,
    socialHandles: null,
    coverImageR2Key: null,
    coverImageContentType: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

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
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} />);

    const radio = screen.getByRole("radio", { name: /Dforce Clásico/ });
    expect(radio).toBeChecked();
    expect(screen.getAllByRole("radio")).toHaveLength(1);
  });

  // The legacy branding inputs (logo URL, colors, typography, cover text)
  // no longer exist — font/colours are template-fixed and logo/cover-text
  // moved to workshop-config, per task 3.12.
  it("no longer renders the legacy branding inputs", () => {
    const { container } = render(<TemplateConfigForm initialConfig={null} workshopConfig={null} />);

    expect(container.querySelector("#logoUrl")).not.toBeInTheDocument();
    expect(container.querySelector("#font")).not.toBeInTheDocument();
    expect(container.querySelector("#coverText")).not.toBeInTheDocument();
  });

  it("renders the image-handling select and the Spanish submit button", () => {
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} />);

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
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} />);

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock)).toEqual({ defaultImageHandling: "strict", selectedTemplateId: DEFAULT_TEMPLATE_ID });
  });

  it("shows the Spanish saved confirmation after a successful submit", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 200, body: { config: { id: "singleton" } } });
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} />);

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText(/Guardado\. Los nuevos catálogos usarán esta plantilla\./)).toBeInTheDocument();
  });
});

/**
 * workshop-feedback-round-1 PR F1 — the preview the builder used to carry
 * lives here now. It is the same shared `CatalogTemplate` the PDF worker
 * renders (Risk-5: one renderer, or the two drift), fed the branding this
 * screen is about to save.
 *
 * What jsdom CANNOT check, and the browser must: that the scaled sheet is
 * legible and actually fits. There is no layout engine here, so these tests
 * assert the MECHANISM is applied and the aspect ratio is untouched (one
 * uniform factor, not a width and a height), never the visual result.
 */
describe("TemplateConfigForm — the catalog preview (PR F1)", () => {
  const sheets = () => [...document.querySelectorAll("[data-sheet]")].map((el) => el.getAttribute("data-sheet"));

  it("renders the sheets the preview can show: cover, index and contact", () => {
    render(<TemplateConfigForm initialConfig={null} workshopConfig={workshop()} />);

    expect(screen.getByRole("region", { name: "Vista previa" })).toBeInTheDocument();
    expect(sheets()).toEqual(["cover", "index-1", "contact"]);
  });

  it("scales the sheet down by one uniform factor instead of printing it at 816px", () => {
    const { container } = render(<TemplateConfigForm initialConfig={null} workshopConfig={workshop()} />);

    const scaler = container.querySelector<HTMLElement>("[data-preview-scale]");
    expect(scaler).not.toBeNull();
    // `zoom` scales LAYOUT as well as paint — the reason the sheet no longer
    // reserves 1056px of height per page. One factor, so the paper's aspect
    // ratio cannot drift: a preview that is not the shape of the page is not
    // a preview of the page.
    const zoom = Number(scaler!.style.zoom);
    expect(zoom).toBeGreaterThan(0);
    expect(zoom).toBeLessThan(1);
    expect(scaler!.querySelector('[data-sheet="cover"]')).not.toBeNull();
  });

  /**
   * The constraint this move had to carry across intact
   * (`specs/workshop-settings/spec.md` "Workshop Logo as Single Source"): the
   * preview reads the logo and cover photo through the SESSION-AUTHENTICATED
   * routes, and the PDF worker inlines those same bytes as data URIs so the
   * two are pixel-identical. A URL supplied when no image exists is a broken
   * `<img>`, so each is gated on its own R2 key.
   */
  it("reads the logo and cover photo through the authenticated routes when they exist", () => {
    render(
      <TemplateConfigForm
        initialConfig={null}
        workshopConfig={workshop({ logoR2Key: "logos/abc", coverImageR2Key: "covers/abc" })}
      />,
    );

    const sources = [...document.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(sources).toContain("/api/workshop-config/logo");
    expect(sources).toContain("/api/workshop-config/cover-image");
  });

  it("renders no image at all when neither key is set", () => {
    render(<TemplateConfigForm initialConfig={null} workshopConfig={workshop()} />);

    // The sheet assertion is load-bearing: "zero images" is also true of a
    // page with no preview on it, so without this the test would pass while
    // the feature it covers was deleted.
    expect(sheets()).toContain("cover");
    expect(document.querySelectorAll("img")).toHaveLength(0);
  });

  it("shows the workshop's saved contact block, the same one the PDF prints", () => {
    render(<TemplateConfigForm initialConfig={null} workshopConfig={workshop({ phone: "+507 6123-4567" })} />);

    expect(screen.getByText("+507 6123-4567")).toBeInTheDocument();
  });

  /** `null` config (no row yet) must not crash the preview — no contact page. */
  it("survives a workshop with no config row", () => {
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} />);

    expect(sheets()).toEqual(["cover", "index-1"]);
  });
});
