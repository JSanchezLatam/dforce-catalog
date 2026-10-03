/**
 * Component tests for the template-config form after
 * catalog-templates-and-workshop-info WU3 (task 3.12, migration `0009`):
 * the legacy logo/color/font/cover-text inputs are gone — font/colours are
 * template-fixed (the registry) and logo/cover-text are workshop-owned. This
 * form now only picks a template and the image-handling mode.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { WorkshopConfig } from "@/shared/db/schema";
import { DEFAULT_TEMPLATE_ID } from "@/shared/template/registry";
import { ToastProvider } from "@/shared/ui/ToastProvider";
import { TemplateConfigForm } from "./TemplateConfigForm";

/** The real provider, as in `OrderStatusControls.test.tsx`: it portals into `document.body`, which is what `screen` queries. */
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: ToastProvider });

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
  it("renders both registry entries, with the classic one pre-selected as the default", () => {
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{}} />);

    const radio = screen.getByRole("radio", { name: /Dforce Clásico/ });
    expect(radio).toBeChecked();
    expect(screen.getByRole("radio", { name: /Portada completa/ })).not.toBeChecked();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  // The preview carries a title shaped like a real one ("Catálogo: <text>"), so
  // the full-cover template shows the split lead + heavy main line it will print.
  it("previews the full-cover title split once that template is picked", async () => {
    const user = userEvent.setup();
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{}} />);

    await user.click(screen.getByRole("radio", { name: /Portada completa/ }));

    expect(screen.getByText("Catálogo:")).toBeInTheDocument();
    expect(screen.getByText("Productos")).toBeInTheDocument();
  });

  // The legacy branding inputs (logo URL, colors, typography, cover text)
  // no longer exist — font/colours are template-fixed and logo/cover-text
  // moved to workshop-config, per task 3.12.
  it("no longer renders the legacy branding inputs", () => {
    const { container } = render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{}} />);

    expect(container.querySelector("#logoUrl")).not.toBeInTheDocument();
    expect(container.querySelector("#font")).not.toBeInTheDocument();
    expect(container.querySelector("#coverText")).not.toBeInTheDocument();
  });

  it("renders the image-handling select and the Spanish submit button", () => {
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{}} />);

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
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{}} />);

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock)).toEqual({ defaultImageHandling: "strict", selectedTemplateId: DEFAULT_TEMPLATE_ID });
  });

  it("shows the Spanish saved confirmation after a successful submit", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 200, body: { config: { id: "singleton" } } });
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{}} />);

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
    render(<TemplateConfigForm initialConfig={null} workshopConfig={workshop()} coverImageKeys={{}} />);

    expect(screen.getByRole("region", { name: "Vista previa" })).toBeInTheDocument();
    expect(sheets()).toEqual(["cover", "index-1", "contact"]);
  });

  it("scales the sheet down by one uniform factor instead of printing it at 816px", () => {
    const { container } = render(<TemplateConfigForm initialConfig={null} workshopConfig={workshop()} coverImageKeys={{}} />);

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
  it("reads the logo through the workshop route and the cover from the SELECTED template's own route", () => {
    render(
      <TemplateConfigForm
        initialConfig={null}
        workshopConfig={workshop({ logoR2Key: "logos/abc", coverImageR2Key: "covers/legacy" })}
        coverImageKeys={{ "dforce-classic": "covers/dforce-classic/1.png" }}
      />,
    );

    const sheet = document.querySelector('[data-sheet="cover"]')!;
    const sources = [...sheet.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(sources).toContain("/api/workshop-config/logo");
    expect(sources).toContain("/api/template-config/cover-image/dforce-classic?v=covers/dforce-classic/1.png");
    // The workshop's legacy column is never read any more.
    expect(sources.join()).not.toContain("workshop-config/cover-image");
  });

  it("renders no image at all when neither key is set", () => {
    render(<TemplateConfigForm initialConfig={null} workshopConfig={workshop()} coverImageKeys={{}} />);

    // The sheet assertion is load-bearing: "zero images" is also true of a
    // page with no preview on it, so without this the test would pass while
    // the feature it covers was deleted.
    expect(sheets()).toContain("cover");
    expect(document.querySelectorAll("img")).toHaveLength(0);
  });

  it("shows the workshop's saved contact block, the same one the PDF prints", () => {
    render(<TemplateConfigForm initialConfig={null} workshopConfig={workshop({ phone: "+507 6123-4567" })} coverImageKeys={{}} />);

    expect(screen.getByText("+507 6123-4567")).toBeInTheDocument();
  });

  /** `null` config (no row yet) must not crash the preview — no contact page. */
  it("survives a workshop with no config row", () => {
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{}} />);

    expect(sheets()).toEqual(["cover", "index-1"]);
  });
});

/**
 * catalog-cover-templates WU3b — one cover-image slot per template, BESIDE the
 * radio tile. A file input inside the radio's <label> would toggle the radio on
 * every click, so the slot is a sibling of the label, never a child.
 */
describe("TemplateConfigForm — per-template cover image slots", () => {
  const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "cover.png", { type: "image/png" });
  const COVER_LABELS = ["Imagen de portada de Dforce Clásico", "Imagen de portada de Portada completa"];

  it("renders one slot per template, each with its own accessible name", () => {
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{}} />);

    for (const name of COVER_LABELS) expect(screen.getByLabelText(name)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^Imagen de portada de /)).toHaveLength(2);
  });

  it("keeps every file input OUT of the radio's <label>", () => {
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{}} />);

    const inputs = COVER_LABELS.map((name) => screen.getByLabelText(name));
    for (const input of inputs) expect(input.closest("label")).toBeNull();
    // ...and the radios still sit inside theirs, so the test cannot pass on a form that lost the tiles.
    for (const radio of screen.getAllByRole("radio")) expect(radio.closest("label")).not.toBeNull();
  });

  it("does not offer SVG in the file picker (covers are PNG, JPEG or WebP)", () => {
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{}} />);

    const accept = screen.getByLabelText(COVER_LABELS[0]).getAttribute("accept");
    expect(accept).toBe("image/png,image/jpeg,image/webp");
  });

  it("uploading in one slot does not toggle the selected radio", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 200, body: { key: "covers/full-cover/1.png" } });
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{}} />);

    await user.upload(screen.getByLabelText(COVER_LABELS[1]), png());

    expect(screen.getByRole("radio", { name: /Dforce Clásico/ })).toBeChecked();
  });

  it("explains the format in Spanish per template, mentions PNG, JPEG, WebP and 2MB, never SVG", () => {
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{}} />);

    const hints = [
      screen.getByText(/se funde con el blanco de la portada/),
      screen.getByText(/la portada la oscurece arriba para el logo/),
    ];
    expect(hints[0]).not.toBe(hints[1]);
    for (const hint of hints) {
      expect(hint.textContent).toMatch(/PNG, JPEG o WebP/);
      expect(hint.textContent).toMatch(/2MB/);
      expect(hint.textContent).not.toMatch(/svg/i);
    }
  });

  it("posts to the template's own route and toasts 'Imagen de portada guardada'", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { key: "covers/full-cover/1.png" } });
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{}} />);

    await user.upload(screen.getByLabelText(COVER_LABELS[1]), png());

    expect(await screen.findByText("Imagen de portada guardada")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/template-config/cover-image/full-cover", expect.objectContaining({ method: "POST" }));
  });

  it("removing an image toasts 'Imagen de portada quitada' and DELETEs that template's route", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { success: true } });
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{ "dforce-classic": "covers/dforce-classic/1.png" }} />);

    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByText("Imagen de portada quitada")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/template-config/cover-image/dforce-classic", expect.objectContaining({ method: "DELETE" }));
  });

  it("toasts nothing when the upload is rejected", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 400, body: { error: "Invalid image format" } });
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{}} />);

    await user.upload(screen.getByLabelText(COVER_LABELS[0]), png());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se pudo subir la imagen");
    expect(alert.textContent).not.toMatch(/svg/i);
    expect(screen.queryByText("Imagen de portada guardada")).not.toBeInTheDocument();
  });

  it("the file input and Eliminar are tall enough to hit (44px rule)", () => {
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{ "dforce-classic": "k" }} />);

    // jsdom has no layout, so the class is the only thing observable here; the
    // pixel measurement is a browser check (task 8.3).
    expect(screen.getByLabelText(COVER_LABELS[0]).className).toMatch(/\bmin-h-11\b/);
    const remove = screen.getByRole("button", { name: "Eliminar" });
    expect(remove.className).toMatch(/\bmin-h-11\b/);
    expect(remove.className).toMatch(/\bmin-w-11\b/);
  });
});

describe("TemplateConfigForm — the preview follows the selected template's image", () => {
  const coverSrc = () => document.querySelector('[data-sheet="cover"] img')?.getAttribute("src") ?? null;

  it("uses the selected template's key, and null when that template has none; switching changes the src", async () => {
    const user = userEvent.setup();
    render(
      <TemplateConfigForm
        initialConfig={null}
        workshopConfig={null}
        coverImageKeys={{ "dforce-classic": "covers/dforce-classic/1.png" }}
      />,
    );

    expect(coverSrc()).toBe("/api/template-config/cover-image/dforce-classic?v=covers/dforce-classic/1.png");

    await user.click(screen.getByRole("radio", { name: /Portada completa/ }));
    expect(coverSrc()).toBeNull();
  });

  it("shows an image uploaded in this session without a refresh", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 200, body: { key: "covers/dforce-classic/9.png" } });
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{}} />);
    expect(coverSrc()).toBeNull();

    await user.upload(
      screen.getByLabelText("Imagen de portada de Dforce Clásico"),
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "c.png", { type: "image/png" }),
    );

    await vi.waitFor(() => expect(coverSrc()).toBe("/api/template-config/cover-image/dforce-classic?v=covers/dforce-classic/9.png"));
  });
});

/**
 * Base UI's bare `<SelectValue />` prints the selected VALUE — Chrome showed
 * `strict` in this trigger while the list read "Estricto (…)".
 */
describe("TemplateConfigForm — the image-handling trigger shows the Spanish label", () => {
  it("shows the strict default as Estricto, not the raw value", () => {
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{}} />);

    const trigger = screen.getByRole("combobox", { name: "Manejo de imágenes" });
    expect(trigger.querySelector('[data-slot="select-value"]')).toHaveTextContent(/^Estricto \(todos los productos enmarcados\)$/);
  });

  it("shows adaptive as Adaptativo once chosen", async () => {
    const user = userEvent.setup();
    render(<TemplateConfigForm initialConfig={null} workshopConfig={null} coverImageKeys={{}} />);

    const trigger = screen.getByRole("combobox", { name: "Manejo de imágenes" });
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: /Adaptativo/ }));

    expect(trigger.querySelector('[data-slot="select-value"]')).toHaveTextContent(/^Adaptativo \(diseño según cada imagen\)$/);
  });
});
