import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Cliente } from "@/shared/db/schema";
import { handleUpdateCliente, PATCH } from "./route";

function requestWith(body: unknown, role = "tecnico") {
  return new NextRequest("http://localhost/api/customers/c1", {
    method: "PATCH",
    headers: { "x-user-id": "user-1", "x-user-role": role, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}


const current = {
  cliente: {
    id: "c1",
    name: "Juan Pérez",
    phone: "+525512345678",
    email: null,
    whatsappOptOut: false,
    emailOptOut: false,
  } as unknown as Cliente,
  orders: [],
  vehicles: [],
};

describe("permanent vehicle deletion is administrador-only", () => {
  /** The customer must actually OWN v1, or the reconcile rejects it as foreign (400) before any gate is observable. */
  const owningV1 = {
    ...current,
    vehicles: [
      { id: "v1", clienteId: "c1", plate: "ABC123", make: null, model: null, year: null, deactivatedAt: null, createdAt: new Date() },
    ],
  } as typeof current;

  /**
   * A vehicle patch is persisted inside a transaction, not through `update`,
   * so the 200 cases need this seam or they hit a real pool. It returns the
   * row without running the body on purpose: what these two assert is that
   * the GATE let the request reach persistence at all, not what was written
   * — the write itself is covered by service.test.ts and the e2e.
   */
  const database = { transaction: async <T>() => current.cliente as T };

  /**
   * `customers.write` is not enough. Deactivation is reversible and every
   * tecnico keeps it; destroying the row is not, and this app routes every
   * other irreversible capability through `policy.ts`. The check reads the
   * RAW body deliberately — before validation, before the service — because
   * the grant governs whether the request may be considered at all, not
   * whether its payload is well-formed.
   */
  it("refuses a tecnico with 403 and never reaches the service", async () => {
    const update = vi.fn();

    const response = await handleUpdateCliente(
      requestWith({ vehicles: [{ id: "v1", plate: "ABC123", deleted: true }] }),
      "c1",
      { getById: async () => owningV1, update, database },
    );

    expect(response.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("lets an administrador through", async () => {
    const update = vi.fn().mockResolvedValue(current.cliente);

    const response = await handleUpdateCliente(
      requestWith({ vehicles: [{ id: "v1", plate: "ABC123", deleted: true }] }, "administrador"),
      "c1",
      { getById: async () => owningV1, update, database },
    );

    expect(response.status).toBe(200);
  });

  /** The gate is scoped to deletion: a tecnico's ordinary vehicle edit is untouched. */
  it("still lets a tecnico deactivate and edit vehicles", async () => {
    const update = vi.fn().mockResolvedValue(current.cliente);

    const response = await handleUpdateCliente(
      requestWith({ vehicles: [{ id: "v1", plate: "ABC123", deactivated: true }] }),
      "c1",
      { getById: async () => owningV1, update, database },
    );

    expect(response.status).toBe(200);
  });
});

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
