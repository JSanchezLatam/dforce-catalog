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

const can = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/modules/auth/policy", () => ({ can }));

const getOrdenServicioById = vi.hoisted(() => vi.fn());
const getClienteById = vi.hoisted(() => vi.fn());
vi.mock("@/modules/service-orders/queries", () => ({ getOrdenServicioById }));
vi.mock("@/modules/customers/queries", () => ({ getClienteById }));

/** The workshop's own name and logo — the same singleton the catalog PDF reads. */
const getWorkshopConfig = vi.hoisted(() => vi.fn<() => Promise<WorkshopConfig | null>>(async () => null));
vi.mock("@/modules/workshop-config/service", () => ({ getWorkshopConfig }));

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
  createdAt: new Date("2026-05-01T14:00:00Z"), updatedAt: new Date("2026-05-01T14:00:00Z"),
  createdBy: null,
};

// Every `cliente` column (schema.ts:294-352).
const CLIENTE: Cliente = {
  id: "c1", name: "Ana Gómez", phone: "61234567", email: "ana@example.com",
  externalId: null, whatsappOptOut: false, emailOptOut: false,
  deactivatedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
};

// Every `vehiculo` column (schema.ts:373-400).
const VEHICULO: Vehiculo = {
  id: "v1", clienteId: "c1", make: "Toyota", model: "Corolla", year: 2020,
  plate: "ABC123", deactivatedAt: null, createdAt: new Date("2026-01-01T00:00:00Z"),
};

function renderPage() {
  return ServiceOrderPrintPage({ params: Promise.resolve({ id: "o1" }) });
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
  can.mockReturnValue(true);
  requireSessionFromHeaders.mockResolvedValue({ id: "u1", role: "tecnico" });
  getOrdenServicioById.mockResolvedValue({ orden: ORDEN, items: [] });
  getClienteById.mockResolvedValue({ cliente: CLIENTE, orders: [], vehicles: [VEHICULO] });
  getWorkshopConfig.mockResolvedValue(null);
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
    // untranslated screen." Six pages already use this exact wording
    // (`builder`, `catalogs`, `inventory`, `users`, `workshop-config`,
    // `customers/[id]/vehicles/[vehicleId]`); five others still carry an
    // English copy of the same sentence, which is its own change.
    expect(screen.getByText("No tenés permiso para ver esta página.")).toBeInTheDocument();
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
