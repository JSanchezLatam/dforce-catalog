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
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OrdenServicio, Vehiculo } from "@/shared/db/schema";

const notFound = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: vi.fn(async () => ({ id: "u1", role: "tecnico" })) }));
vi.mock("@/modules/auth/policy", () => ({ can: vi.fn(() => true) }));

const getClienteById = vi.hoisted(() => vi.fn());
const listOrdenesByVehiculo = vi.hoisted(() => vi.fn(async (): Promise<OrdenServicio[]> => []));
vi.mock("@/modules/customers/queries", () => ({ getClienteById }));
vi.mock("@/modules/service-orders/queries", () => ({ listOrdenesByVehiculo }));

import VehicleDetailPage from "./page";

function vehiculo(overrides: Partial<Vehiculo> = {}): Vehiculo {
  return {
    id: "v1", clienteId: "c1", make: "Toyota", model: "Corolla", year: 2020,
    plate: "ABC123", deactivatedAt: null, createdAt: new Date("2026-01-01"),
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
    listOrdenesByVehiculo.mockResolvedValue([
      { id: "o1", status: "open", categoria: "reparacion", description: "Cambio de correa",
        appointmentAt: null, createdAt: new Date("2026-05-01T14:00:00Z") } as OrdenServicio,
    ]);

    render(await renderPage());

    expect(screen.getByRole("link", { name: /ver/i })).toHaveAttribute("href", "/service-orders/o1");
  });

  it("404s on a vehicle that belongs to a different customer", async () => {
    getClienteById.mockResolvedValue({ cliente: { id: "c1", name: "Ana Gómez" }, orders: [], vehicles: [] });

    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });
});
