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
 * only verification this unit has for any of that. These tests cover the data
 * the sheet carries, the block it must never fill, and the read gate.
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
const getWorkshopConfig = vi.hoisted(() => vi.fn(async () => null as { name: string | null; logoR2Key: string | null } | null));
vi.mock("@/modules/workshop-config/service", () => ({ getWorkshopConfig }));

import type { Role } from "@/modules/auth/roles";
import type { Cliente, OrdenServicio, Vehiculo } from "@/shared/db/schema";
import { formatDateTime } from "@/shared/datetime";
import ServiceOrderPrintPage from "./page";

const APPOINTMENT_AT = new Date("2026-06-02T15:30:00Z");

// Every `orden_servicio` column (schema.ts:410-440), not the six this sheet
// reads: AGENTS.md — "a mock more convenient than reality tests the mock, not
// the code." `hallazgos`/`recomendaciones` are SET here on purpose; D9 says
// the sheet must not print them.
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

describe("ServiceOrderPrintPage", () => {
  beforeEach(() => {
    // These mocks are module-level; without this, call counts accumulate
    // across tests and `not.toHaveBeenCalled()` below would assert nothing.
    vi.clearAllMocks();
    can.mockReturnValue(true);
    requireSessionFromHeaders.mockResolvedValue({ id: "u1", role: "tecnico" });
    getOrdenServicioById.mockResolvedValue({ orden: ORDEN, items: [] });
    getClienteById.mockResolvedValue({ cliente: CLIENTE, orders: [], vehicles: [VEHICULO] });
  });

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
   * Spec Scenario "Printed page reserves handwriting space"; D9.
   *
   * The fixture has BOTH `hallazgos` and `recomendaciones` set, which is the
   * whole point: this is a reprint of a worked order, and the block still has
   * to come out blank. Wiring either field into it — the obvious "helpful"
   * change — fails here.
   */
  it("renders the handwriting block empty even on an order that already has hallazgos and recomendaciones", async () => {
    render(await renderPage());

    expect(screen.getByText("Trabajo realizado / Hallazgos")).toBeInTheDocument();
    expect(screen.getByText("Firma del técnico")).toBeInTheDocument();

    // `textContent`, not `queryByText`. Measured during this unit's mutation
    // round: RTL's default matcher reads an element's DIRECT text-node
    // children, so wiring BOTH fields into one node renders
    // "Bujías gastadasCambiar la correa…" and `queryByText` matched neither —
    // the mutation passed. A substring scan of the whole rendered sheet
    // catches that wiring and the one-node-each wiring alike.
    expect(document.body.textContent).not.toContain("Bujías gastadas");
    expect(document.body.textContent).not.toContain("Cambiar la correa de distribución");
    // No label either — a "Hallazgos" term would mean the field found its way
    // onto the sheet under another name.
    expect(screen.getAllByRole("term").map((dt) => dt.textContent)).not.toContain("Hallazgos");
    expect(screen.getAllByRole("term").map((dt) => dt.textContent)).not.toContain("Recomendaciones");
  });

  /** The same block, on an order that has nothing stored: it is layout, so it
   *  renders unconditionally rather than depending on any field. */
  it("renders the handwriting block on an order with no hallazgos or recomendaciones", async () => {
    getOrdenServicioById.mockResolvedValue({
      orden: { ...ORDEN, hallazgos: null, recomendaciones: null },
      items: [],
    });

    render(await renderPage());

    expect(screen.getByText("Trabajo realizado / Hallazgos")).toBeInTheDocument();
    expect(screen.getByText("Firma del técnico")).toBeInTheDocument();
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
describe("ServiceOrderPrintPage — the sheet a técnico is handed", () => {
  it("carries the workshop's name so the sheet says who did the work", async () => {
    getWorkshopConfig.mockResolvedValue({ name: "DForce Car Audio", logoR2Key: null });

    render(await renderPage());

    expect(screen.getByText("DForce Car Audio")).toBeInTheDocument();
  });

  it("shows the workshop logo when one is configured, through the route that serves it", async () => {
    getWorkshopConfig.mockResolvedValue({ name: "DForce Car Audio", logoR2Key: "logos/abc" });

    render(await renderPage());

    expect(screen.getByRole("img", { name: /DForce Car Audio/ })).toHaveAttribute(
      "src",
      "/api/workshop-config/logo",
    );
  });

  // Nullable columns: the Administrador may set any subset independently.
  it("renders no broken image when no logo is configured", async () => {
    getWorkshopConfig.mockResolvedValue({ name: "DForce Car Audio", logoR2Key: null });

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

  it("renders the field labels in red, the colour staff scan the sheet by", async () => {
    render(await renderPage());

    const label = screen.getAllByRole("term").find((dt) => dt.textContent === "Cliente");
    expect(label!.className).toContain("text-red");
  });
});
