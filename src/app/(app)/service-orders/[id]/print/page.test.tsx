/**
 * WU3 — the printed work order (design D8/D9, spec §"Printable Work Order").
 *
 * Same technique as `[id]/page.test.tsx`: await the server component, hand the
 * element to RTL, mock only the request-scoped and data edges.
 *
 * WHAT THESE TESTS DO NOT COVER, stated plainly rather than implied away:
 * jsdom applies no `@media print` rules, `window.print()` is a stub, and a
 * page invoked as a plain function has no RSC serialization to violate. So
 * nothing here is evidence that the sidebar vanishes on paper, that the sheet
 * fits one page, that the margins are right, or that `PrintButton` mounts in a
 * browser. Task 3.12 — a real print preview with the console open — is the
 * only verification this unit has for any of that. In particular, no test here
 * can show that a long `hallazgos` wraps instead of running off the sheet:
 * that is `whitespace-pre-wrap break-words` against a paper width, and jsdom
 * measures nothing. Nor can anything here show that a worked order's findings
 * PLUS its ruled lines still fit one Letter sheet — the line count is chosen
 * against a page budget no test can measure. These tests cover the data the
 * sheet carries, what the findings block contains for each combination of the
 * two columns, and the read gate.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }));
vi.mock("next/navigation", () => ({ notFound }));

const requireSessionFromHeaders = vi.hoisted(() =>
  vi.fn(async () => ({ id: "u1", role: "tecnico" as Role })),
);
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders }));

const can = vi.hoisted(() => vi.fn<(user: unknown, action: string) => boolean>(() => true));
vi.mock("@/modules/auth/policy", () => ({ can }));
const SCOPE = vi.hoisted(() => ({ where: "scope-sentinel" }));
const orderScope = vi.hoisted(() => vi.fn<(user: unknown) => typeof SCOPE>(() => SCOPE));
vi.mock("@/modules/service-orders/scope", () => ({ orderScope }));

const getOrdenServicioById = vi.hoisted(() => vi.fn());
const getClienteById = vi.hoisted(() => vi.fn());
vi.mock("@/modules/service-orders/queries", () => ({ getOrdenServicioById }));
vi.mock("@/modules/customers/queries", () => ({ getClienteById }));

/** The workshop's own name and logo — the same singleton the catalog PDF reads. */
const getWorkshopConfig = vi.hoisted(() => vi.fn<() => Promise<WorkshopConfig | null>>(async () => null));
vi.mock("@/modules/workshop-config/service", () => ({ getWorkshopConfig }));

const listOrderPhotos = vi.hoisted(() => vi.fn<(id: string, scope: unknown) => Promise<{ id: string }[]>>(async () => []));
vi.mock("@/modules/service-orders/photos", () => ({ listOrderPhotos }));

/** Latest consent of the order's customer; `null` is "no row ever recorded". */
const currentConsent = vi.hoisted(() => vi.fn<(id: string) => Promise<{ granted: boolean } | null>>(async () => null));
vi.mock("@/modules/customers/consent", () => ({ currentConsent }));

/** `env` is read at render time, so a test can unset it. */
const envMock = vi.hoisted(() => ({
  PORTAL_BASE_URL: undefined as string | undefined,
  PORTAL_INGEST_URL: "http://localhost:3001/api/ingest" as string | undefined,
  PORTAL_INGEST_SECRET: "secret" as string | undefined,
}));
vi.mock("@/shared/config/env", () => ({ env: envMock }));

/** The REAL encoder, spied: the SVG under test is what the library draws, and the input is what it was asked to encode. */
const renderQrSvg = vi.hoisted(() => vi.fn());
vi.mock("@/modules/service-orders/qr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/service-orders/qr")>();
  renderQrSvg.mockImplementation(actual.renderQrSvg);
  return { renderQrSvg };
});

// `undefined` = the real SHOW_CONSENT_CLAUSE, so the default-state tests read the shipped value.
const clauseFlag = vi.hoisted(() => ({ show: undefined as boolean | undefined }));
vi.mock("@/modules/customers/consent-clause", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/customers/consent-clause")>();
  return {
    ...actual,
    get SHOW_CONSENT_CLAUSE() {
      return clauseFlag.show ?? actual.SHOW_CONSENT_CLAUSE;
    },
  };
});

import type { Role } from "@/modules/auth/roles";
import type { Cliente, OrdenServicio, Vehiculo, WorkshopConfig } from "@/shared/db/schema";
import { formatDateTime } from "@/shared/datetime";
import ServiceOrderPrintPage from "./page";

const APPOINTMENT_AT = new Date("2026-06-02T15:30:00Z");

// Every `orden_servicio` column (schema.ts:410-440), not the six this sheet
// reads: AGENTS.md — "a mock more convenient than reality tests the mock, not
// the code." `hallazgos`/`recomendaciones` are SET here on purpose: this is a
// reprint of a WORKED order, and D9-revised says both must reach the paper.
const ORDEN: OrdenServicio = {
  id: "o1", clienteId: "c1", vehiculoId: "v1", status: "in_progress", categoria: "revisado",
  description: "Ruido en el tren delantero", appointmentAt: APPOINTMENT_AT, completedAt: null,
  hallazgos: "Bujías gastadas", recomendaciones: "Cambiar la correa de distribución",
  observaciones: "El cliente espera en el taller",
  kilometraje: null,
  nivelCombustible: null,
  bateriaPct: null,
  createdAt: new Date("2026-05-01T14:00:00Z"), updatedAt: new Date("2026-05-01T14:00:00Z"),
  createdBy: null,
};

// Every `cliente` column (schema.ts:294-352).
const CLIENTE: Cliente = {
  id: "c1", name: "Ana Gómez", phone: "61234567", email: "ana@example.com",
  documentoIdentidad: null, externalId: null, whatsappOptOut: false, emailOptOut: false,
  deactivatedAt: null, portalToken: null,
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
};

// Every `vehiculo` column (the `vehiculo` table in schema.ts).
const VEHICULO: Vehiculo = {
  id: "v1", clienteId: "c1", make: "Toyota", model: "Corolla", year: 2020,
  plate: "ABC123", deactivatedAt: null,
  chasis: null, colorPrimario: null, colorSecundario: null, estilo: null, motor: null,
  numeroUnidad: null, placaRenovacionMes: null, placaMunicipio: null, seguroVence: null, createdAt: new Date("2026-01-01T00:00:00Z"),
};

function renderPage(copia?: string | string[]) {
  return ServiceOrderPrintPage({
    params: Promise.resolve({ id: "o1" }),
    searchParams: Promise.resolve(copia === undefined ? {} : { copia }),
  });
}

/**
 * The `<dd>` beside a `<dt>`, read RAW. `getByText` runs its default
 * normalizer over the DOM text but not over the expected string, so an
 * `Intl`-formatted time — which separates "a. m." with U+202F and U+00A0 —
 * never matches a literal comparison. Reading `textContent` compares the two
 * unnormalized, which is also the stricter assertion.
 */
function valueFor(label: string): string {
  const term = screen.getAllByRole("term").find((dt) => dt.textContent === label);
  expect(term, `no <dt> labelled "${label}"`).toBeDefined();
  return term!.nextElementSibling!.textContent!;
}

/**
 * The ruled lines the técnico writes on, counted from the DOM rather than from
 * a test hook: they are the `aria-hidden` rows inside the findings section, so
 * this reads the shipped markup and needs nothing added to it for testing.
 * Scoped to the section — an `aria-hidden` decoration anywhere else on the
 * sheet must not be miscounted as pen space.
 */
function ruledLineCount(): number {
  const section = screen.getByText("Trabajo realizado / Hallazgos").closest("section")!;
  return section.querySelectorAll('[aria-hidden="true"] > div').length;
}

/**
 * FILE scope, not inside the first `describe`. It used to live in there, and
 * the second block declared no setup of its own — so its tests passed on mock
 * IMPLEMENTATIONS that leaked across the block boundary. `vitest.config.ts`
 * sets neither `clearMocks` nor `mockReset`, and `vi.clearAllMocks()` clears
 * call records, not implementations, so nothing reset them. Running that block
 * alone (`-t "the sheet a"`) failed all six on `NEXT_NOT_FOUND`.
 */
beforeEach(() => {
  // These mocks are module-level; without this, call counts accumulate across
  // tests and `not.toHaveBeenCalled()` below would assert nothing.
  vi.clearAllMocks();
  clauseFlag.show = undefined;
  can.mockReturnValue(true);
  requireSessionFromHeaders.mockResolvedValue({ id: "u1", role: "tecnico" });
  getOrdenServicioById.mockResolvedValue({ orden: ORDEN, items: [] });
  getClienteById.mockResolvedValue({ cliente: CLIENTE, orders: [], vehicles: [VEHICULO] });
  getWorkshopConfig.mockResolvedValue(null);
  listOrderPhotos.mockResolvedValue([]);
  currentConsent.mockResolvedValue(null);
  envMock.PORTAL_BASE_URL = undefined;
  envMock.PORTAL_INGEST_URL = "http://localhost:3001/api/ingest";
  envMock.PORTAL_INGEST_SECRET = "secret";
  renderQrSvg.mockClear();
});

describe("ServiceOrderPrintPage — vehicle descriptive fields", () => {
  it("prints chasis, both colors on one line, estilo, motor in Spanish and the unit number beside placa/marca/modelo/año", async () => {
    getClienteById.mockResolvedValue({
      cliente: CLIENTE, orders: [],
      vehicles: [{
        ...VEHICULO, chasis: "3N6AD33A0LK812345", colorPrimario: "Gris", colorSecundario: "Negro",
        estilo: "Pick-up", motor: "electrico", numeroUnidad: "U-12",
      }],
    });

    render(await renderPage());

    expect(valueFor("Placa")).toBe("ABC123");
    expect(valueFor("Chasis")).toBe("3N6AD33A0LK812345");
    expect(valueFor("Color")).toBe("Gris / Negro");
    expect(valueFor("Estilo")).toBe("Pick-up");
    expect(valueFor("Motor")).toBe("Eléctrico");
    expect(valueFor("Nº de unidad")).toBe("U-12");
  });

  it("prints only the primary color, a dash for unset fields, and no unit label when it is empty", async () => {
    getClienteById.mockResolvedValue({
      cliente: CLIENTE, orders: [], vehicles: [{ ...VEHICULO, colorPrimario: "Rojo" }],
    });

    render(await renderPage());

    expect(valueFor("Color")).toBe("Rojo");
    for (const label of ["Chasis", "Estilo", "Motor"]) {
      expect(valueFor(label), label).toBe("—");
    }
    expect(screen.queryByText("Nº de unidad")).not.toBeInTheDocument();
  });

  it("never prints the plate renewal month or the insurance expiry, even when the row carries them", async () => {
    getClienteById.mockResolvedValue({
      cliente: CLIENTE, orders: [],
      vehicles: [{ ...VEHICULO, chasis: "CH1", placaRenovacionMes: 11, placaMunicipio: "SENTINEL-MUNICIPIO", seguroVence: "2031-12-24" }],
    });

    const { container } = render(await renderPage());

    const text = container.textContent!;
    expect(text).not.toContain("2031-12-24");
    expect(text).not.toContain("SENTINEL-MUNICIPIO");
    expect(text).not.toContain("24/12/2031");
    expect(text).not.toContain("noviembre");
    expect(screen.getAllByRole("definition").map((dd) => dd.textContent)).not.toContain("11");
    expect(valueFor("Chasis")).toBe("CH1");
  });
});

describe("ServiceOrderPrintPage", () => {

  /** Spec Scenario "Printed page carries the order's data". */
  it("prints cliente, vehículo, categoría, fecha y hora de inicio, descripción and observaciones", async () => {
    render(await renderPage());

    const terms = screen.getAllByRole("term").map((dt) => dt.textContent);
    expect(terms).toEqual(
      expect.arrayContaining([
        "Cliente", "Teléfono", "Placa", "Marca", "Modelo", "Año",
        "Categoría", "Fecha y hora de inicio", "Descripción", "Observaciones",
      ]),
    );

    expect(screen.getByText("Ana Gómez")).toBeInTheDocument();
    expect(screen.getByText("61234567")).toBeInTheDocument();
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    expect(screen.getByText("Toyota")).toBeInTheDocument();
    expect(screen.getByText("Corolla")).toBeInTheDocument();
    expect(screen.getByText("2020")).toBeInTheDocument();
    // The label a técnico reads, never the enum slug stored in Postgres.
    expect(screen.getByText("REVISADO")).toBeInTheDocument();
    expect(screen.queryByText("revisado")).not.toBeInTheDocument();
    expect(screen.getByText("Ruido en el tren delantero")).toBeInTheDocument();
    expect(screen.getByText("El cliente espera en el taller")).toBeInTheDocument();
    // Through `formatDateTime`, so the sheet reads America/Panama and not the
    // server's zone. This asserts the RENDERED value, which catches a missing
    // field and a raw Date/ISO string; it cannot catch the helper itself being
    // wrong — `datetime.test.ts` owns that.
    expect(valueFor("Fecha y hora de inicio")).toBe(formatDateTime(APPOINTMENT_AT));
  });

  /**
   * D9-revised-again (2026-09-15, the owner after using the sheet). The block
   * is no longer either/or: whatever was recorded prints AND ruled lines
   * follow it, so every sheet leaves the pen somewhere to go.
   *
   * The four tests below pin all four input combinations of the two columns,
   * and each asserts BOTH halves — what reached the paper, and that the
   * writing lines are still under it. Asserting only the first half is how the
   * previous revision shipped: it printed the findings and silently took the
   * lines away, and no test noticed because none looked.
   *
   * The fixture has BOTH fields set: this is the reprint of a worked order.
   */
  it("prints hallazgos, under its own Spanish label, when the order has them", async () => {
    render(await renderPage());

    expect(screen.getByText("Trabajo realizado / Hallazgos")).toBeInTheDocument();
    expect(valueFor("Hallazgos")).toBe("Bujías gastadas");
  });

  /**
   * Two columns, two meanings. `getAllByRole("term")`/`nextElementSibling`
   * reads the value of EACH row separately, so merging both fields into one
   * node — the tempting shortcut — cannot satisfy both of these assertions.
   */
  it("prints recomendaciones as recomendaciones, not merged into hallazgos", async () => {
    render(await renderPage());

    expect(valueFor("Recomendaciones")).toBe("Cambiar la correa de distribución");
    expect(valueFor("Hallazgos")).not.toContain("correa");
  });

  /**
   * The owner's actual report, and the one this revision exists for: he filled
   * hallazgos and recomendaciones from the computer, printed, and the sheet
   * came back with nowhere to write. Both columns recorded is the case he was
   * looking at.
   *
   * FOUR lines, not the eight a blank block gets. The page decides that, not
   * taste: this is one Letter sheet with the signature line below it, and the
   * two printed rows are already eating the headroom the lines used to have.
   */
  it("keeps ruled writing lines under findings that were recorded from the computer", async () => {
    render(await renderPage());

    expect(valueFor("Hallazgos")).toBe("Bujías gastadas");
    expect(valueFor("Recomendaciones")).toBe("Cambiar la correa de distribución");
    expect(ruledLineCount()).toBe(4);
  });

  /**
   * The fourth combination, and the one that is unchanged: nothing recorded,
   * so nothing prints and the whole block is pen space — all eight lines, as
   * it has been since D9.
   */
  it("still reserves the eight ruled lines when neither field has content", async () => {
    getOrdenServicioById.mockResolvedValue({
      orden: { ...ORDEN, hallazgos: null, recomendaciones: null },
      items: [],
    });

    render(await renderPage());

    expect(screen.getByText("Trabajo realizado / Hallazgos")).toBeInTheDocument();
    expect(screen.getByText("Firma del técnico")).toBeInTheDocument();
    expect(ruledLineCount()).toBe(8);
    expect(screen.getAllByRole("term").map((dt) => dt.textContent)).not.toContain("Hallazgos");
    expect(screen.getAllByRole("term").map((dt) => dt.textContent)).not.toContain("Recomendaciones");
  });

  /**
   * One present, one empty — the case with a real decision behind it. The
   * order has been worked, so both rows print whole: the empty column keeps
   * its row and prints the same "—" every other absent value on this sheet
   * prints, because (per `field`'s own comment) a printed form with a MISSING
   * row reads as a different form. The writing lines follow either way.
   */
  it("prints hallazgos with an em dash for the recomendaciones nobody wrote, and still rules lines", async () => {
    getOrdenServicioById.mockResolvedValue({
      orden: { ...ORDEN, recomendaciones: null },
      items: [],
    });

    render(await renderPage());

    expect(valueFor("Hallazgos")).toBe("Bujías gastadas");
    expect(valueFor("Recomendaciones")).toBe("—");
    expect(ruledLineCount()).toBe(4);
  });

  it("prints recomendaciones with an em dash for the hallazgos nobody wrote, and still rules lines", async () => {
    getOrdenServicioById.mockResolvedValue({
      orden: { ...ORDEN, hallazgos: null },
      items: [],
    });

    render(await renderPage());

    expect(valueFor("Recomendaciones")).toBe("Cambiar la correa de distribución");
    expect(valueFor("Hallazgos")).toBe("—");
    expect(ruledLineCount()).toBe(4);
  });

  /**
   * A textarea the técnico tabbed through and left holding a newline stores
   * `"\n"`, not `null` — `ServiceOrderForm` trims, but `PATCH` takes any
   * string. Blank-looking content must not cost a fresh order its pen space.
   */
  it("treats whitespace-only findings as empty and keeps the ruled lines", async () => {
    getOrdenServicioById.mockResolvedValue({
      orden: { ...ORDEN, hallazgos: "   ", recomendaciones: "\n" },
      items: [],
    });

    render(await renderPage());

    expect(ruledLineCount()).toBe(8);
  });

  /**
   * Structure, not paint. `whitespace-pre-wrap` keeps the técnico's line
   * breaks and `break-words` stops one long unbroken token from running off
   * the sheet. jsdom has no Tailwind and no page width, so this asserts the
   * classes are on the value row and NOTHING about how it lands on Letter —
   * the print preview owns that.
   */
  it("gives free-text values the classes that wrap them instead of overflowing", async () => {
    render(await renderPage());

    const value = screen.getAllByRole("term")
      .find((dt) => dt.textContent === "Hallazgos")!.nextElementSibling!;
    expect(value.className).toContain("whitespace-pre-wrap");
    expect(value.className).toContain("break-words");
  });

  /** Spec Scenario "Print view enforces the same read gate". */
  it("refuses a session without service-orders.read, exactly as the detail page does", async () => {
    can.mockReturnValue(false);

    render(await renderPage());

    expect(can).toHaveBeenCalledWith({ id: "u1", role: "tecnico" }, "service-orders.read");
    // AGENTS.md: "Tests assert the Spanish string. Those are what catch an
    // untranslated screen." Every gated page uses this exact wording.
    expect(screen.getByRole("heading", { level: 1, name: "Orden de servicio" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "No tenés permiso para ver esta página" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
    // Not "the data happens to be absent" — the page must not have queried.
    expect(getOrdenServicioById).not.toHaveBeenCalled();
    expect(screen.queryByText("Ana Gómez")).not.toBeInTheDocument();
  });

  it("404s an order that does not exist", async () => {
    getOrdenServicioById.mockResolvedValue(null);

    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  /**
   * C4's deactivated-vehicle case, carried over from the detail page: the car
   * left the customer, its service history did not, and `getClienteById` reads
   * with `includeInactive: true` so the sheet still identifies it.
   */
  it("still prints a DEACTIVATED vehicle's identity", async () => {
    getClienteById.mockResolvedValue({
      cliente: CLIENTE,
      orders: [],
      vehicles: [{ ...VEHICULO, deactivatedAt: new Date("2026-02-01T00:00:00Z") }],
    });

    render(await renderPage());

    expect(screen.getByText("ABC123")).toBeInTheDocument();
  });

  /**
   * `PrintButton` is deliberately NOT mocked: a stub rendering the label would
   * assert the stub. This proves the click reaches `window.print` and that the
   * control is marked off the paper — it does NOT prove the button mounts in a
   * browser (jsdom cannot see an RSC refusal) or that `print:hidden` resolves
   * to any CSS (jsdom has no Tailwind).
   */
  it("offers Imprimir, which calls window.print and is itself excluded from the print output", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});

    render(await renderPage());

    const button = screen.getByRole("button", { name: "Imprimir" });
    expect(button.className).toContain("print:hidden");

    await userEvent.click(button);
    expect(print).toHaveBeenCalledTimes(1);

    print.mockRestore();
  });
});

/**
 * Everything below is what a browser settles and jsdom cannot, EXCEPT the
 * parts that are structure rather than paint. These pin the structure; the
 * print preview is what proved the background defect that started this change.
 */
/**
 * Every column of `workshop_config`, not the two these assertions read.
 * AGENTS.md: "a mock more convenient than reality tests the mock, not the
 * code" — and the fixtures forty lines above already build complete rows for
 * exactly that reason.
 */
function workshop(overrides: Partial<WorkshopConfig> = {}): WorkshopConfig {
  return {
    id: "singleton",
    name: "DForce Car Audio",
    logoR2Key: null,
    logoContentType: null,
    phone: null,
    whatsapp: null,
    email: null,
    address: null,
    hours: null,
    website: null,
    coverText: null,
    socialHandles: null,
    coverImageR2Key: null,
    coverImageContentType: null,
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("ServiceOrderPrintPage — the sheet a técnico is handed", () => {
  it("carries the workshop's name so the sheet says who did the work", async () => {
    getWorkshopConfig.mockResolvedValue(workshop());

    render(await renderPage());

    expect(screen.getByText("DForce Car Audio")).toBeInTheDocument();
  });

  it("shows the workshop logo when one is configured, through the route that serves it", async () => {
    getWorkshopConfig.mockResolvedValue(workshop({ logoR2Key: "logos/abc", logoContentType: "image/png" }));

    render(await renderPage());

    expect(screen.getByRole("img", { name: /DForce Car Audio/ })).toHaveAttribute(
      "src",
      "/api/workshop-config/logo",
    );
  });

  // Nullable columns: the Administrador may set any subset independently.
  it("renders no broken image when no logo is configured", async () => {
    getWorkshopConfig.mockResolvedValue(workshop());

    render(await renderPage());

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("offers a way back to the order, which the sheet had no control for", async () => {
    render(await renderPage());

    const back = screen.getByRole("link", { name: /Volver/ });
    expect(back).toHaveAttribute("href", "/service-orders/o1");
  });

  // The back control is for the screen. On paper it is noise, like Imprimir.
  it("hides the back control from the printed sheet", async () => {
    render(await renderPage());

    expect(screen.getByRole("link", { name: /Volver/ }).className).toContain("print:hidden");
  });

  /**
   * Mechanism, not measurement — jsdom has no Tailwind and cannot measure a
   * printed page. The sheet is a centred `max-w-3xl` card on SCREEN, which is
   * right for reading; on paper that same width left a small block adrift in
   * the middle of a Letter page. `@page { size: letter }` in `globals.css`
   * owns the size and the margin; these classes hand the content the rest.
   * The print preview is what settles the real inches.
   */
  it("hands the sheet the full printable width on paper, while staying a card on screen", async () => {
    render(await renderPage());

    const sheet = screen.getByText("Orden de servicio").closest("div[class*='bg-white']");
    expect(sheet!.className).toContain("max-w-3xl"); // still a card on screen
    expect(sheet!.className).toContain("print:w-full");
    expect(sheet!.className).toContain("print:max-w-full");
  });

  it("renders the field labels in red, the colour staff scan the sheet by", async () => {
    render(await renderPage());

    const label = screen.getAllByRole("term").find((dt) => dt.textContent === "Cliente");
    // The SHADE, not the family. `toContain("text-red")` passed for
    // `text-red-50` — a near-invisible label on a white sheet, which is the
    // exact defect this requirement exists to prevent.
    expect(label!.className).toContain("text-red-700");
  });
});

describe("ServiceOrderPrintPage — reception rows", () => {
  const terms = () => screen.getAllByRole("term").map((dt) => dt.textContent);

  it("prints Cédula / RUC right after Teléfono when the customer has one", async () => {
    getClienteById.mockResolvedValue({
      cliente: { ...CLIENTE, documentoIdentidad: "8-123-456" }, orders: [], vehicles: [VEHICULO],
    });

    render(await renderPage());

    expect(valueFor("Cédula / RUC")).toBe("8-123-456");
    const t = terms();
    expect(t.indexOf("Cédula / RUC")).toBe(t.indexOf("Teléfono") + 1);
  });

  it("omits the Cédula / RUC row when it is null or blank", async () => {
    render(await renderPage());
    expect(terms()).not.toContain("Cédula / RUC");

    getClienteById.mockResolvedValue({
      cliente: { ...CLIENTE, documentoIdentidad: "  " }, orders: [], vehicles: [VEHICULO],
    });
    document.body.innerHTML = "";
    render(await renderPage());
    expect(terms()).not.toContain("Cédula / RUC");
  });

  it("prints Kilometraje with the thousands separator, and a dash when none was recorded", async () => {
    getOrdenServicioById.mockResolvedValue({ orden: { ...ORDEN, kilometraje: 84320 }, items: [] });
    render(await renderPage());
    expect(valueFor("Kilometraje")).toBe("84.320 km");

    document.body.innerHTML = "";
    getOrdenServicioById.mockResolvedValue({ orden: ORDEN, items: [] });
    render(await renderPage());
    expect(valueFor("Kilometraje")).toBe("—");
  });

  it("prints Combustible as its label and Batería as a percentage, each only when recorded", async () => {
    getOrdenServicioById.mockResolvedValue({
      orden: { ...ORDEN, nivelCombustible: 2, bateriaPct: 72 }, items: [],
    });
    render(await renderPage());
    expect(valueFor("Combustible")).toBe("1/2");
    expect(valueFor("Batería")).toBe("72 %");

    document.body.innerHTML = "";
    getOrdenServicioById.mockResolvedValue({ orden: ORDEN, items: [] });
    render(await renderPage());
    expect(terms()).not.toContain("Combustible");
    expect(terms()).not.toContain("Batería");
  });

  it("prints fuel 0 (Vacío): a recorded zero is not an absent value", async () => {
    getOrdenServicioById.mockResolvedValue({ orden: { ...ORDEN, nivelCombustible: 0 }, items: [] });
    render(await renderPage());
    expect(valueFor("Combustible")).toBe("Vacío");
  });

  it("never prints the renewal month or insurance expiry (named-field allowlist)", async () => {
    getClienteById.mockResolvedValue({
      cliente: CLIENTE, orders: [],
      vehicles: [{ ...VEHICULO, placaRenovacionMes: 11, placaMunicipio: "SENTINEL-MUNICIPIO", seguroVence: "2031-12-24" }],
    });
    const { container } = render(await renderPage());
    expect(container.textContent).not.toContain("2031");
    expect(container.textContent).not.toContain("SENTINEL-MUNICIPIO");
    expect(terms()).not.toContain("Renovación de placa");
    expect(terms()).not.toContain("Seguro vence");
  });
});

describe("ServiceOrderPrintPage — QR slot", () => {
  it("reserves a 25 mm aria-hidden square in the header with no text and no border", async () => {
    const { container } = render(await renderPage());

    const slot = container.querySelector<HTMLElement>('[aria-hidden="true"][class*="size-[25mm]"]');
    expect(slot).not.toBeNull();
    expect(slot!.textContent).toBe("");
    expect(slot!.children).toHaveLength(0);
    expect(slot!.className).not.toMatch(/border/);
    expect(slot!.closest("div.border-b-2")).not.toBeNull();
  });
});

describe("ServiceOrderPrintPage — reception photos", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}` }));
  const chunks = (c: HTMLElement) => Array.from(c.querySelectorAll("section.break-before-page"));

  it("renders no photo block for an order without photos", async () => {
    const { container } = render(await renderPage());

    expect(chunks(container)).toHaveLength(0);
    expect(screen.queryByText(/Fotos de recepción/)).not.toBeInTheDocument();
    expect(listOrderPhotos).toHaveBeenCalledWith("o1", SCOPE);
  });

  it.each([[4, [4]], [5, [4, 1]], [9, [4, 4, 1]]])("%i photos make chunks %j, one page each", async (n, sizes) => {
    listOrderPhotos.mockResolvedValue(ids(n));
    const { container } = render(await renderPage());

    expect(chunks(container).map((c) => c.querySelectorAll("img").length)).toEqual(sizes);
  });

  it("keeps position order across chunks, numbers captions globally, and serves each image eagerly from the authenticated route", async () => {
    listOrderPhotos.mockResolvedValue(ids(5));
    const { container } = render(await renderPage());

    const imgs = Array.from(container.querySelectorAll<HTMLImageElement>("section.break-before-page img"));
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual(
      ["p1", "p2", "p3", "p4", "p5"].map((p) => `/api/service-orders/o1/photos/${p}`),
    );
    imgs.forEach((i) => expect(i).toHaveAttribute("loading", "eager"));
    expect(Array.from(container.querySelectorAll("figcaption")).map((c) => c.textContent)).toEqual(
      ["Foto 1", "Foto 2", "Foto 3", "Foto 4", "Foto 5"],
    );
  });

  it("heads every photo page with the order number", async () => {
    listOrderPhotos.mockResolvedValue(ids(5));
    render(await renderPage());

    expect(screen.getAllByRole("heading", { name: "Fotos de recepción — Orden N.º o1" })).toHaveLength(2);
  });

  it("keeps the signature on page 1, before any photo page", async () => {
    listOrderPhotos.mockResolvedValue(ids(1));
    const { container } = render(await renderPage());

    const signature = screen.getByText("Firma del técnico");
    const firstChunk = container.querySelector("section.break-before-page")!;
    expect(signature.compareDocumentPosition(firstChunk) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(firstChunk.contains(signature)).toBe(false);
  });
});

describe("ServiceOrderPrintPage — order scope", () => {
  it("scopes the order, the customer lookup and the photos by the session user; an unassigned order is a 404", async () => {
    render(await renderPage());

    expect(orderScope).toHaveBeenCalledWith({ id: "u1", role: "tecnico" });
    expect(getOrdenServicioById.mock.calls[0][1]).toBe(SCOPE);
    expect(getClienteById.mock.calls[0][1]).toBe(SCOPE);
    expect(listOrderPhotos.mock.calls[0][1]).toBe(SCOPE);

    getOrdenServicioById.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

// customer-portal WU2 — the consent clause on the workshop copy and the
// "Copia del cliente" with the portal QR.
describe("ServiceOrderPrintPage — consent clause and the two copies (customer-portal WU2)", () => {
  const TOKEN = "SENTINEL-PORTAL-TOKEN-0123456789abcdefghijklm";
  const BASE = "http://192.168.0.3:3001";
  const BANNER = "Texto provisorio — pendiente de revisión legal";
  const NOTICE = "Este código da acceso a tu historial. No lo compartas.";

  /** A consented, active customer holding a token with a configured portal: the one case that prints a QR. */
  function consented(overrides: Partial<Cliente> = {}) {
    currentConsent.mockResolvedValue({ granted: true });
    envMock.PORTAL_BASE_URL = BASE;
    getClienteById.mockResolvedValue({ cliente: { ...CLIENTE, portalToken: TOKEN, ...overrides }, orders: [], vehicles: [VEHICULO] });
  }

  describe("workshop copy (the default)", () => {
    it("carries the clause, banner first, and the Firma del cliente line for a consented customer when SHOW_CONSENT_CLAUSE is on", async () => {
      clauseFlag.show = true;
      consented();
      render(await renderPage());

      const clause = screen.getByTestId("consent-clause");
      expect(clause.textContent?.startsWith(BANNER)).toBe(true);
      expect(clause.textContent).toMatch(/fuera de Panamá/);
      expect(screen.getByText("Firma del cliente")).toBeInTheDocument();
      // The technician's line is still there, and so is the findings block it closes.
      expect(screen.getByText("Firma del técnico")).toBeInTheDocument();
      expect(screen.getByText("Trabajo realizado / Hallazgos")).toBeInTheDocument();
    });

    it("hides the provisional clause by default but keeps Firma del cliente, right-aligned", async () => {
      consented();
      render(await renderPage());

      expect(screen.queryByTestId("consent-clause")).not.toBeInTheDocument();
      expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
      const firma = screen.getByText("Firma del cliente");
      expect(screen.getByText("Firma del técnico")).toBeInTheDocument();
      // With nothing beside it, the signature block sits right as it did without consent.
      expect(firma.parentElement?.parentElement).toHaveClass("justify-end");
    });

    it("carries neither the clause nor Firma del cliente without current consent", async () => {
      currentConsent.mockResolvedValue({ granted: false });
      render(await renderPage());

      expect(screen.queryByTestId("consent-clause")).not.toBeInTheDocument();
      expect(screen.queryByText("Firma del cliente")).not.toBeInTheDocument();
      expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
      expect(screen.getByText("Firma del técnico")).toBeInTheDocument();
    });

    it("carries neither when the customer never consented", async () => {
      render(await renderPage());

      expect(screen.queryByTestId("consent-clause")).not.toBeInTheDocument();
      expect(screen.queryByText("Firma del cliente")).not.toBeInTheDocument();
    });

    it("keeps the 25 mm slot blank and prints no QR, with or without consent", async () => {
      consented();
      const { container } = render(await renderPage());

      const slot = container.querySelector<HTMLElement>('[aria-hidden="true"][class*="size-[25mm]"]');
      expect(slot).not.toBeNull();
      expect(slot!.textContent).toBe("");
      expect(slot!.children).toHaveLength(0);
      expect(container.querySelector("svg")).toBeNull();
      expect(renderQrSvg).not.toHaveBeenCalled();
      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    });

    it("never lets the token into the HTML", async () => {
      consented();
      const { container } = render(await renderPage());

      expect(container.innerHTML).not.toContain(TOKEN);
    });

    it("offers the Copia del cliente control, off the paper, to a consented customer with a configured portal", async () => {
      consented();
      render(await renderPage());

      const link = screen.getByRole("link", { name: "Copia del cliente" });
      expect(link).toHaveAttribute("href", "/service-orders/o1/print?copia=cliente");
      expect(link).toHaveClass("print:hidden", "min-h-11", "min-w-11");
    });
  });

  describe("customer copy (?copia=cliente)", () => {
    it("shows the QR of <PORTAL_BASE_URL>/c#<token> in the slot, with the notice", async () => {
      consented();
      const { container } = render(await renderPage("cliente"));

      expect(renderQrSvg).toHaveBeenCalledWith(`${BASE}/c#${TOKEN}`);
      const qr = screen.getByRole("img", { name: "Código QR del portal del cliente" });
      expect(qr.className).toMatch(/size-\[25mm\]/);
      expect(qr.querySelector("svg")).not.toBeNull();
      expect(screen.getByText(NOTICE)).toBeInTheDocument();
      // The token is only ever INSIDE the encoded drawing, never as text or an attribute.
      expect(container.innerHTML).not.toContain(TOKEN);
    });

    it("tolerates a trailing slash on PORTAL_BASE_URL", async () => {
      consented();
      envMock.PORTAL_BASE_URL = `${BASE}/`;
      await renderPage("cliente");

      expect(renderQrSvg).toHaveBeenCalledWith(`${BASE}/c#${TOKEN}`);
    });

    it("is titled Copia del cliente and carries the order's identifying data", async () => {
      consented();
      render(await renderPage("cliente"));

      expect(screen.getByRole("heading", { level: 1, name: "Copia del cliente" })).toBeInTheDocument();
      expect(screen.getByText("N.º o1")).toBeInTheDocument();
      expect(valueFor("Cliente")).toBe("Ana Gómez");
      expect(valueFor("Placa")).toBe("ABC123");
      expect(valueFor("Descripción")).toBe("Ruido en el tren delantero");
      expect(valueFor("Categoría")).toBeTruthy();
      expect(valueFor("Fecha y hora de inicio")).toBe(formatDateTime(APPOINTMENT_AT));
    });

    it("has no Firma del cliente, no signature block, no findings block and no photos", async () => {
      consented();
      listOrderPhotos.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
      const { container } = render(await renderPage("cliente"));

      expect(screen.queryByText("Firma del cliente")).not.toBeInTheDocument();
      expect(screen.queryByText("Firma del técnico")).not.toBeInTheDocument();
      expect(screen.queryByText("Trabajo realizado / Hallazgos")).not.toBeInTheDocument();
      expect(container.querySelectorAll("img[src*='/photos/']")).toHaveLength(0);
      expect(listOrderPhotos).not.toHaveBeenCalled();
    });

    it("keeps the staff-only rows off the customer's paper", async () => {
      consented();
      render(await renderPage("cliente"));

      expect(screen.queryByText("Observaciones")).not.toBeInTheDocument();
      expect(screen.queryByText("Teléfono")).not.toBeInTheDocument();
      expect(screen.queryByText("El cliente espera en el taller")).not.toBeInTheDocument();
    });

    it("withholds the Copia del cliente control on the customer copy itself", async () => {
      consented();
      render(await renderPage("cliente"));

      expect(screen.queryByRole("link", { name: "Copia del cliente" })).not.toBeInTheDocument();
    });

    it("carries the clause when consent is current and SHOW_CONSENT_CLAUSE is on, but no signature line", async () => {
      clauseFlag.show = true;
      consented();
      render(await renderPage("cliente"));

      expect(screen.getByTestId("consent-clause").textContent?.startsWith(BANNER)).toBe(true);
    });

    it("hides the provisional clause by default but keeps the QR and its notice", async () => {
      consented();
      render(await renderPage("cliente"));

      expect(screen.queryByTestId("consent-clause")).not.toBeInTheDocument();
      expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Código QR del portal del cliente" })).toBeInTheDocument();
      expect(screen.getByText(NOTICE)).toBeInTheDocument();
    });

    it("ignores any other copia value and prints the workshop copy", async () => {
      consented();
      render(await renderPage("otra"));

      expect(screen.getByText("Firma del técnico")).toBeInTheDocument();
      expect(screen.queryByRole("img", { name: "Código QR del portal del cliente" })).not.toBeInTheDocument();
    });

    it("reads the first value when copia is repeated", async () => {
      consented();
      render(await renderPage(["cliente", "taller"]));

      expect(screen.getByRole("img", { name: "Código QR del portal del cliente" })).toBeInTheDocument();
    });
  });

  describe("the QR is withheld, without an error and with no control, when ANY condition fails", () => {
    const cases: [string, () => void][] = [
      ["the customer has no current consent", () => currentConsent.mockResolvedValue({ granted: false })],
      ["the customer never consented", () => currentConsent.mockResolvedValue(null)],
      ["the customer has no token", () => getClienteById.mockResolvedValue({ cliente: { ...CLIENTE, portalToken: null }, orders: [], vehicles: [VEHICULO] })],
      ["the customer is deactivated", () => getClienteById.mockResolvedValue({ cliente: { ...CLIENTE, portalToken: TOKEN, deactivatedAt: new Date("2026-02-01") }, orders: [], vehicles: [VEHICULO] })],
      ["PORTAL_BASE_URL is unset", () => { envMock.PORTAL_BASE_URL = undefined; }],
      ["PORTAL_BASE_URL is blank", () => { envMock.PORTAL_BASE_URL = "  "; }],
      // The sync is off: a printed QR would only ever open "Este enlace no es válido".
      ["PORTAL_INGEST_URL is unset", () => { envMock.PORTAL_INGEST_URL = undefined; }],
      ["PORTAL_INGEST_SECRET is unset", () => { envMock.PORTAL_INGEST_SECRET = undefined; }],
    ];

    it.each(cases)("when %s", async (_label, breakIt) => {
      consented();
      breakIt();

      const customer = render(await renderPage("cliente"));
      expect(renderQrSvg).not.toHaveBeenCalled();
      expect(customer.container.querySelector("svg")).toBeNull();
      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
      expect(screen.queryByRole("img", { name: "Código QR del portal del cliente" })).not.toBeInTheDocument();
      expect(customer.container.innerHTML).not.toContain(TOKEN);
      customer.unmount();

      render(await renderPage());
      expect(screen.queryByRole("link", { name: "Copia del cliente" })).not.toBeInTheDocument();
    });
  });

  describe("what neither copy may carry", () => {
    it.each([undefined, "cliente"])("never prints the renewal month, municipality or insurance expiry (copia=%s)", async (copia) => {
      consented();
      getClienteById.mockResolvedValue({
        cliente: { ...CLIENTE, portalToken: TOKEN },
        orders: [],
        vehicles: [{ ...VEHICULO, placaRenovacionMes: 7, placaMunicipio: "SENTINEL-MUNICIPIO", seguroVence: "2031-12-24" }],
      });
      const { container } = render(await renderPage(copia));

      expect(container.textContent).not.toContain("SENTINEL-MUNICIPIO");
      expect(container.textContent).not.toContain("2031-12-24");
    });
  });

  describe("read gate", () => {
    it("refuses the customer copy without service-orders.read, before any customer or token read", async () => {
      consented();
      can.mockImplementation((_user, action) => action !== "service-orders.read");
      render(await renderPage("cliente"));

      expect(screen.getByText(/permiso/i)).toBeInTheDocument();
      expect(getClienteById).not.toHaveBeenCalled();
      expect(currentConsent).not.toHaveBeenCalled();
      expect(renderQrSvg).not.toHaveBeenCalled();
    });
  });
});
