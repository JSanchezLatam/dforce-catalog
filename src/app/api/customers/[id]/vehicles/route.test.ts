import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Vehiculo } from "@/shared/db/schema";
import { GET, handleListVehiculosByCliente } from "./route";

function requestFor(id: string, headers: Record<string, string> = { "x-user-id": "u1", "x-user-role": "tecnico" }) {
  return new NextRequest(`http://localhost/api/customers/${id}/vehicles`, { headers });
}

function fakeVehiculo(overrides: Partial<Vehiculo> = {}): Vehiculo {
  return {
    id: "v1",
    clienteId: "c1",
    make: "Toyota",
    model: "Corolla",
    year: 2020,
    plate: "ABC111",
    deactivatedAt: null,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("GET /api/customers/[id]/vehicles (C4, task 1.11 — the gap D2 found)", () => {
  it("throws when called without session headers", async () => {
    await expect(
      GET(new NextRequest("http://localhost/api/customers/c1/vehicles"), { params: Promise.resolve({ id: "c1" }) }),
    ).rejects.toThrow();
  });

  it("403s a user without customers.read", async () => {
    // No role in policy.ts's MATRIX grants false for customers.read today,
    // so this is exercised via an unknown role instead of a real denial.
    const response = await handleListVehiculosByCliente(requestFor("c1", { "x-user-id": "u1", "x-user-role": "unknown" }), "c1");
    expect(response.status).toBe(403);
  });

  // Delegation only. "active-only" is a property of `listVehiculosByCliente`
  // itself and is proven in `vehicles.test.ts`; injecting a fake here cannot
  // prove it, and a name claiming otherwise sells coverage that isn't here.
  it("delegates to listVehiculosByCliente with the customer id and returns its rows", async () => {
    const listVehiculosByCliente = vi.fn().mockResolvedValue([fakeVehiculo()]);
    const response = await handleListVehiculosByCliente(requestFor("c1"), "c1", { listVehiculosByCliente });

    expect(response.status).toBe(200);
    expect(listVehiculosByCliente).toHaveBeenCalledWith("c1");
    const body = await response.json();
    expect(body.vehicles).toEqual([expect.objectContaining({ id: "v1", plate: "ABC111" })]);
  });
});
