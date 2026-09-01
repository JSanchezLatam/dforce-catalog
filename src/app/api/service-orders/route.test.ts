import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { handleCreateOrdenServicio, POST } from "./route";

function requestWith(body: unknown) {
  return new NextRequest("http://localhost/api/service-orders", {
    method: "POST",
    headers: { "x-user-id": "user-1", "x-user-role": "tecnico", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const vehiculo1 = { id: "v1", clienteId: "cli-1", deactivatedAt: null };

const clienteDetail = { cliente: { id: "cli-1" }, orders: [], vehicles: [vehiculo1] } as unknown as {
  cliente: { id: string };
  orders: unknown[];
  vehicles: unknown[];
};

describe("POST /api/service-orders (R20)", () => {
  it("throws when called without session headers", async () => {
    const request = new NextRequest("http://localhost/api/service-orders", {
      method: "POST",
      body: JSON.stringify({ clienteId: "cli-1" }),
    });
    await expect(POST(request)).rejects.toThrow();
  });

  it("creates an order with no parts and returns 201", async () => {
    const database = {
      transaction: async (cb: (tx: unknown) => unknown) =>
        cb({
          insert: () => ({
            values: (values: unknown) => ({ returning: async () => [{ id: "o1", status: "open", ...(values as object) }] }),
          }),
        }),
    };

    const response = await handleCreateOrdenServicio(
      requestWith({ clienteId: "cli-1", vehiculoId: "v1", categoria: "revisado" }),
      {
        getClienteById: async () => clienteDetail as never,
        db: database as never,
      },
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.orden.status).toBe("open");
  });

  it("rejects an unknown clienteId with 400 before touching the DB", async () => {
    const database = { transaction: vi.fn() };

    const response = await handleCreateOrdenServicio(requestWith({ clienteId: "missing" }), {
      getClienteById: async () => null,
      db: database as never,
    });

    expect(response.status).toBe(400);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("rejects an invalid vehiculoId with 400 under errors.vehiculoId (C4, task 1.7)", async () => {
    const database = { transaction: vi.fn() };

    const response = await handleCreateOrdenServicio(
      requestWith({ clienteId: "cli-1", vehiculoId: "not-owned", categoria: "revisado" }),
      {
        getClienteById: async () => clienteDetail as never,
        db: database as never,
      },
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toHaveProperty("vehiculoId");
    expect(database.transaction).not.toHaveBeenCalled();
  });
});
