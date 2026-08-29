import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Cliente } from "@/shared/db/schema";
import { handleUpdateCliente, PATCH } from "./route";

function requestWith(body: unknown) {
  return new NextRequest("http://localhost/api/customers/c1", {
    method: "PATCH",
    headers: { "x-user-id": "user-1", "x-user-role": "tecnico", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const current = {
  cliente: {
    id: "c1",
    name: "Juan Pérez",
    phone: "+525512345678",
    email: null,
    vehicleMake: null,
    vehicleModel: null,
    vehicleYear: null,
    vehiclePlate: null,
    whatsappOptOut: false,
    emailOptOut: false,
  } as unknown as Cliente,
  orders: [],
};

describe("PATCH /api/customers/[id] (R16)", () => {
  it("throws when called without session headers", async () => {
    const request = new NextRequest("http://localhost/api/customers/c1", {
      method: "PATCH",
      body: JSON.stringify({ name: "Nuevo" }),
    });
    await expect(PATCH(request, { params: Promise.resolve({ id: "c1" }) })).rejects.toThrow();
  });

  it("persists only the changed field and returns 200 (R16)", async () => {
    const update = vi.fn().mockResolvedValue({ ...current.cliente, name: "Juan P." });

    const response = await handleUpdateCliente(requestWith({ name: "Juan P." }), "c1", {
      getById: async () => current,
      update,
    });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith("c1", { name: "Juan P." });
  });

  it("toggles whatsappOptOut/emailOptOut independently (R26)", async () => {
    const update = vi.fn().mockResolvedValue({ ...current.cliente, whatsappOptOut: true });

    await handleUpdateCliente(requestWith({ whatsappOptOut: true }), "c1", {
      getById: async () => current,
      update,
    });

    expect(update).toHaveBeenCalledWith("c1", { whatsappOptOut: true });
  });

  it("returns 404 for a missing cliente", async () => {
    const response = await handleUpdateCliente(requestWith({ name: "x" }), "missing", {
      getById: async () => null,
    });
    expect(response.status).toBe(404);
  });

  it("returns 409 on a duplicate-phone edit (R18)", async () => {
    const response = await handleUpdateCliente(requestWith({ phone: "+525599998888" }), "c1", {
      getById: async () => current,
      findByPhone: async () => ({ id: "c2" }) as unknown as Cliente,
    });
    expect(response.status).toBe(409);
  });

  it("returns 400 on a validation error", async () => {
    const response = await handleUpdateCliente(requestWith({ name: "" }), "c1", {
      getById: async () => current,
    });
    expect(response.status).toBe(400);
  });

  it("returns 400 for a vehicles entry missing its plate, unchanged error mapping (D5/D6)", async () => {
    const response = await handleUpdateCliente(requestWith({ vehicles: [{ make: "Toyota" }] }), "c1", {
      getById: async () => current,
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors["vehicles.0.plate"]).toBeTruthy();
  });
});
