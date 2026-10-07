/**
 * First `page.tsx` test in this repo. C4 verify returned FAIL because 7 spec
 * scenarios had no runtime coverage and all 7 were page rendering — the exact
 * layer where two real defects surfaced during this change (a hover
 * specificity collision, and dates rendering in the server's timezone), both
 * invisible to `npm test`, `tsc` and lint.
 *
 * No harness and no new dependency: a server component is an async function
 * returning JSX, so awaiting it and handing the element to RTL is the whole
 * technique. Only the request-scoped and data edges are mocked.
 */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OrdenServicio, Vehiculo } from "@/shared/db/schema";

const notFound = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: vi.fn(async () => ({ id: "u1", role: "tecnico" })) }));
const can = vi.hoisted(() => vi.fn<(user: unknown, action: string) => boolean>(() => true));
vi.mock("@/modules/auth/policy", () => ({ can }));

const getClienteById = vi.hoisted(() => vi.fn());
const listOrdenesByVehiculo = vi.hoisted(() => vi.fn(async (): Promise<OrdenServicio[]> => []));
vi.mock("@/modules/customers/queries", () => ({ getClienteById }));
vi.mock("@/modules/service-orders/queries", () => ({ listOrdenesByVehiculo }));

import VehicleDetailPage from "./page";

function vehiculo(overrides: Partial<Vehiculo> = {}): Vehiculo {
  return {
    id: "v1", clienteId: "c1", make: "Toyota", model: "Corolla", year: 2020,
    plate: "ABC123", deactivatedAt: null, createdAt: new Date("2026-01-01"),
    chasis: null, colorPrimario: null, colorSecundario: null, estilo: null, motor: null, numeroUnidad: null,
    placaRenovacionMes: null, placaMunicipio: null, seguroVence: null,
    ...overrides,
  } as Vehiculo;
}

function renderPage() {
  return VehicleDetailPage({ params: Promise.resolve({ id: "c1", vehicleId: "v1" }) });
}

describe("VehicleDetailPage", () => {
  beforeEach(() => {
    getClienteById.mockResolvedValue({ cliente: { id: "c1", name: "Ana Gómez" }, orders: [], vehicles: [vehiculo()] });
    listOrdenesByVehiculo.mockResolvedValue([]);
  });

  it("renders the vehicle's identity and a breadcrumb back to its customer", async () => {
    render(await renderPage());

    // Twice on purpose: the breadcrumb's current-page label AND the identity
    // card's plate badge. Asserting a single match would fail for the wrong
    // reason and teach the next reader the page renders one.
    expect(screen.getAllByText("ABC123")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Ana Gómez" })).toHaveAttribute("href", "/customers/c1");
  });

  it("shows an empty-state MESSAGE instead of a bare table when the vehicle has no history", async () => {
    render(await renderPage());

    // Both halves of the spec sentence: "MUST show an explicit empty-state
    // message INSTEAD OF an empty table". Asserting only the missing table
    // passes on a page that renders nothing at all, which is the failure the
    // scenario is actually about.
    expect(screen.getByText(/todav[ií]a no tiene [óo]rdenes/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("marks a DEACTIVATED vehicle as such, instead of rendering it like a working one", async () => {
    getClienteById.mockResolvedValue({
      cliente: { id: "c1", name: "Ana Gómez" },
      orders: [],
      vehicles: [vehiculo({ deactivatedAt: new Date("2026-02-01") })],
    });

    render(await renderPage());

    expect(screen.getByText(/veh[ií]culo desactivado/i)).toBeInTheDocument();
  });

  it("links each history row to its own order", async () => {
    // "Verificar frenos" starts with "ver": unscoped, /ver/i would match
    // its phone card's link too. The query is scoped to the table, where the
    // action is literally "Ver".
    listOrdenesByVehiculo.mockResolvedValue([
      { id: "o1", status: "open", categoria: "reparacion", description: "Cambio de correa",
        appointmentAt: null, createdAt: new Date("2026-05-01T14:00:00Z") } as OrdenServicio,
      { id: "o2", status: "open", categoria: "reparacion", description: "Verificar frenos",
        appointmentAt: null, createdAt: new Date("2026-05-02T14:00:00Z") } as OrdenServicio,
    ]);

    render(await renderPage());

    const links = within(screen.getByTestId("history-table")).getAllByRole("link", { name: /ver/i });
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/service-orders/o1", "/service-orders/o2"]);
  });

  it("404s on a vehicle that belongs to a different customer", async () => {
    getClienteById.mockResolvedValue({ cliente: { id: "c1", name: "Ana Gómez" }, orders: [], vehicles: [] });

    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });
});

describe("VehicleDetailPage — descriptive and internal fields", () => {
  const FULL = {
    chasis: "MR0HA3CD100512345", colorPrimario: "Blanco", colorSecundario: "Negro",
    estilo: "Pick-up", motor: "hibrido" as const, numeroUnidad: "U-07",
    placaRenovacionMes: 10, seguroVence: "2026-10-28",
  };

  beforeEach(() => {
    can.mockReturnValue(true);
    listOrdenesByVehiculo.mockResolvedValue([]);
    getClienteById.mockResolvedValue({ cliente: { id: "c1", name: "Ana Gómez" }, orders: [], vehicles: [vehiculo(FULL)] });
  });

  it("shows every set descriptive field to anyone who can read customers", async () => {
    can.mockImplementation((_user, action) => action !== "vencimientos.read");
    render(await renderPage());

    expect(screen.getByText("MR0HA3CD100512345")).toBeInTheDocument();
    expect(screen.getByText("Blanco")).toBeInTheDocument();
    expect(screen.getByText("Negro")).toBeInTheDocument();
    expect(screen.getByText("Pick-up")).toBeInTheDocument();
    expect(screen.getByText("Híbrido")).toBeInTheDocument();
    expect(screen.getByText("U-07")).toBeInTheDocument();
  });

  it("omits a descriptive field that is not set instead of printing an empty row", async () => {
    getClienteById.mockResolvedValue({ cliente: { id: "c1", name: "Ana Gómez" }, orders: [], vehicles: [vehiculo({ colorPrimario: "Blanco" })] });
    render(await renderPage());

    expect(screen.getByText("Blanco")).toBeInTheDocument();
    expect(screen.queryByText("Chasis")).not.toBeInTheDocument();
    expect(screen.queryByText("Motor")).not.toBeInTheDocument();
  });

  it("shows the renewal month and the insurance expiry to a viewer with vencimientos.read", async () => {
    render(await renderPage());

    expect(screen.getByText("Mes de renovación de placa")).toBeInTheDocument();
    expect(screen.getByText("Octubre")).toBeInTheDocument();
    expect(screen.getByText("Vencimiento del seguro")).toBeInTheDocument();
    // Split from the stored string: parsing "2026-10-28" as a Date shifts it a day in a western zone.
    expect(screen.getByText("28/10/2026")).toBeInTheDocument();
  });

  it("renders neither internal field, label or value, for a viewer without vencimientos.read", async () => {
    can.mockImplementation((_user, action) => action !== "vencimientos.read");
    const { container } = render(await renderPage());

    expect(screen.queryByText("Mes de renovación de placa")).not.toBeInTheDocument();
    expect(screen.queryByText("Vencimiento del seguro")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("Octubre");
    expect(container).not.toHaveTextContent("28/10/2026");
  });
});

/** mobile-responsive-pass WU6 (#4) — same contract as the customer detail history. */
describe("VehicleDetailPage — order history cards (WU6)", () => {
  const order = (id: string, status: string) =>
    ({ id, status, categoria: "reparacion", description: "Cambio de correa",
      appointmentAt: null, createdAt: new Date("2026-05-01T14:00:00Z") }) as OrdenServicio;

  async function renderHistory(orders: OrdenServicio[]) {
    getClienteById.mockResolvedValue({ cliente: { id: "c1", name: "Ana Gómez" }, orders: [], vehicles: [vehiculo()] });
    listOrdenesByVehiculo.mockResolvedValue(orders);
    render(await renderPage());
    return {
      table: within(screen.getByTestId("history-table")),
      cards: within(screen.getByTestId("history-cards")),
    };
  }

  it("hides the table below md and the card list from md up", async () => {
    await renderHistory([order("o1", "open")]);

    expect(screen.getByTestId("history-table")).toHaveClass("hidden", "md:block");
    expect(screen.getByTestId("history-cards")).toHaveClass("md:hidden");
  });

  it("makes each card a link to its order, with status, category and description inside", async () => {
    const { cards } = await renderHistory([order("o1", "open")]);

    const link = cards.getByRole("link");
    expect(link).toHaveAttribute("href", "/service-orders/o1");
    expect(within(link).getByText("Abierta")).toBeInTheDocument();
    expect(link).toHaveTextContent("Reparación");
    expect(link).toHaveTextContent("Cambio de correa");
  });

  it("renders as many cards as table rows", async () => {
    const { table, cards } = await renderHistory([order("o1", "open"), order("o2", "done")]);

    expect(cards.getAllByRole("listitem")).toHaveLength(2);
    expect(table.getAllByRole("row")).toHaveLength(1 + 2);
  });
});
