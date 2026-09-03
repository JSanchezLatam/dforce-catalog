/**
 * C4 verify gap: "click a vehicle card → navigate to its detail" had no runtime
 * coverage. Task 3.3 turned both card variants into links, and design D6 says
 * active and deactivated are told apart by WEIGHT rather than a caption — so
 * the deactivated one has to stay reachable, not just styled differently.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: vi.fn(async () => ({ id: "u1", role: "tecnico" })) }));
vi.mock("@/modules/auth/policy", () => ({ can: vi.fn(() => true) }));
vi.mock("@/modules/customers/CustomerFormTrigger", () => ({ CustomerFormTrigger: () => null }));

const getClienteById = vi.hoisted(() => vi.fn());
vi.mock("@/modules/customers/queries", () => ({ getClienteById }));

import CustomerDetailPage from "./page";

function vehiculo(id: string, plate: string, deactivatedAt: Date | null) {
  return { id, clienteId: "c1", plate, make: "Toyota", model: "Corolla", year: 2020, deactivatedAt, createdAt: new Date("2026-01-01") };
}

function renderPage() {
  return CustomerDetailPage({ params: Promise.resolve({ id: "c1" }) });
}

describe("CustomerDetailPage", () => {
  beforeEach(() => {
    getClienteById.mockResolvedValue({
      cliente: { id: "c1", name: "Ana Gómez", phone: "50761111111", email: null, createdAt: new Date("2026-01-01") },
      orders: [],
      vehicles: [vehiculo("v1", "ABC123", null), vehiculo("v2", "XYZ789", new Date("2026-02-01"))],
    });
  });

  it("links every vehicle card to its own history, deactivated ones included", async () => {
    render(await renderPage());

    expect(screen.getByRole("link", { name: /ABC123/ })).toHaveAttribute("href", "/customers/c1/vehicles/v1");
    // The car is out of service; its history is not. A retired vehicle that
    // renders as a dead end is the failure this asserts against.
    expect(screen.getByRole("link", { name: /XYZ789/ })).toHaveAttribute("href", "/customers/c1/vehicles/v2");
  });
});
