/**
 * C4 verify gap: the three order-detail rendering scenarios had no runtime
 * coverage. Same technique as the vehicle page — await the server component,
 * hand the element to RTL, mock only the request-scoped and data edges.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: vi.fn(async () => ({ id: "u1", role: "tecnico" })) }));
vi.mock("@/modules/auth/policy", () => ({ can: vi.fn(() => true) }));
vi.mock("@/modules/service-orders/OrderStatusControls", () => ({ OrderStatusControls: () => null }));

const getOrdenServicioById = vi.hoisted(() => vi.fn());
const getClienteById = vi.hoisted(() => vi.fn());
const listRemindersForOrder = vi.hoisted(() => vi.fn(async () => []));
vi.mock("@/modules/service-orders/queries", () => ({ getOrdenServicioById }));
vi.mock("@/modules/customers/queries", () => ({ getClienteById }));
vi.mock("@/modules/reminders/queries", () => ({ listRemindersForOrder }));

import ServiceOrderDetailPage from "./page";

const ORDEN = {
  id: "o1", clienteId: "c1", vehiculoId: "v1", status: "open", categoria: "revisado",
  description: null, appointmentAt: null, completedAt: null,
  hallazgos: null, recomendaciones: null, observaciones: null,
  createdAt: new Date("2026-05-01T14:00:00Z"), createdBy: null,
};

function detailWith(deactivatedAt: Date | null) {
  return {
    cliente: { id: "c1", name: "Ana Gómez" },
    orders: [],
    vehicles: [{ id: "v1", clienteId: "c1", plate: "ABC123", make: "Toyota", model: "Corolla", year: 2020, deactivatedAt, createdAt: new Date("2026-01-01") }],
  };
}

function renderPage() {
  return ServiceOrderDetailPage({ params: Promise.resolve({ id: "o1" }) });
}

describe("ServiceOrderDetailPage", () => {
  beforeEach(() => {
    getOrdenServicioById.mockResolvedValue({ orden: ORDEN, items: [] });
    getClienteById.mockResolvedValue(detailWith(null));
    listRemindersForOrder.mockResolvedValue([]);
  });

  it("shows the vehicle as a link to its history, and the category in Spanish", async () => {
    render(await renderPage());

    expect(screen.getByRole("link", { name: "ABC123" })).toHaveAttribute("href", "/customers/c1/vehicles/v1");
    // The label a technician reads, not the enum slug stored in Postgres.
    expect(screen.getByText("REVISADO")).toBeInTheDocument();
    expect(screen.queryByText("revisado")).not.toBeInTheDocument();
  });

  it("renders an unset note as a placeholder row, never as a missing one", async () => {
    render(await renderPage());

    // `field()` bails on "" as well as null, which is why the page passes
    // `|| "—"` and not `??` — the row has to exist so the reader can tell
    // "nothing recorded" from "this order has no such field".
    expect(screen.getByText("Hallazgos")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("still shows the vehicle's identity and link when that vehicle is DEACTIVATED", async () => {
    getClienteById.mockResolvedValue(detailWith(new Date("2026-02-01")));

    render(await renderPage());

    // The car left the customer; its service history did not. This only works
    // because getClienteById reads with includeInactive: true.
    expect(screen.getByRole("link", { name: "ABC123" })).toHaveAttribute("href", "/customers/c1/vehicles/v1");
  });
});
