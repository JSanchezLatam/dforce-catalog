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

describe("POST /api/service-orders (service-orders R20)", () => {
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

    const response = await handleCreateOrdenServicio(requestWith({ clienteId: "missing", vehiculoId: "v1", categoria: "revisado" }), {
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

  /**
   * GGA round 5 on PR1. The branch this covers was added in round 3 without a
   * route test — service.test.ts proves createOrder THROWS, and the form test
   * mocks a hand-written 400 body. The wire between them, "the service's
   * categoria error becomes a 400 keyed categoria", was asserted nowhere, and
   * it is the exact claim task 1.13b rests on.
   */
  it("rejects an invalid categoria with 400 under errors.categoria", async () => {
    const database = { transaction: vi.fn() };

    const response = await handleCreateOrdenServicio(
      requestWith({ clienteId: "cli-1", vehiculoId: "v1", categoria: "cualquier_cosa" }),
      { getClienteById: async () => clienteDetail as never, db: database as never },
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toEqual({ categoria: "Elegí un tipo de servicio válido" });
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("rejects a missing categoria with 400 — the column is NOT NULL with no default", async () => {
    const database = { transaction: vi.fn() };

    const response = await handleCreateOrdenServicio(requestWith({ clienteId: "cli-1", vehiculoId: "v1" }), {
      getClienteById: async () => clienteDetail as never,
      db: database as never,
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toEqual({ categoria: "Elegí un tipo de servicio válido" });
    expect(database.transaction).not.toHaveBeenCalled();
  });
  /**
   * Follow-up 1.18, raised by GGA round 3 on PR #57 and carried through the
   * C4 archive. `createOrder` took `createdBy` from its input and the route
   * handed it `await request.json()`, so a client could attribute an order to
   * anyone by putting their id in the body. The session is the only thing
   * that knows who is acting; the body is a claim.
   */
  it("attributes the order to the SESSION user, not to whoever the body names", async () => {
    let inserted: Record<string, unknown> = {};
    const database = {
      transaction: async (cb: (tx: unknown) => unknown) =>
        cb({
          insert: () => ({
            values: (values: Record<string, unknown>) => {
              inserted = values;
              return { returning: async () => [{ id: "o1", status: "open", ...values }] };
            },
          }),
        }),
    };

    const response = await handleCreateOrdenServicio(
      requestWith({ clienteId: "cli-1", vehiculoId: "v1", categoria: "revisado", createdBy: "otro-usuario" }),
      { getClienteById: async () => clienteDetail as never, db: database as never },
    );

    expect(response.status).toBe(201);
    // "user-1" is the x-user-id header requestWith() sends.
    expect(inserted.createdBy).toBe("user-1");
  });
});

/**
 * R20/D5 — the service throws; this is the only thing that proves it comes
 * back as a 409 rather than an unhandled 500. Its twin in
 * `api/customers/[id]/route.test.ts` exists for the same reason.
 */
/**
 * The bug this pins was live and total: the orders table was EMPTY because
 * EVERY save the form could produce failed. `datetime-local` holds a string —
 * `""` until someone picks a moment — and JSON has no Date type, so the body's
 * `appointmentAt` is always a string or absent. `CreateOrdenServicioInput`
 * declares `Date | null`, so the route spreading the body straight through
 * handed Drizzle a string, which died on `value.toISOString is not a function`.
 *
 * Measured against a real Postgres before the fix: absent and `null` saved;
 * `""` and `"2026-09-10T09:00"` both threw. That is every value the form emits.
 *
 * The PATCH route already converted here and create simply never did — the
 * declared type was a claim the only real caller could not satisfy, which is
 * AGENTS.md's "await response.json() makes every declared type a claim".
 */
describe("POST /api/service-orders — appointmentAt crosses JSON as a string", () => {
  const database = {
    transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        insert: () => ({
          values: (values: unknown) => ({ returning: async () => [{ id: "o1", status: "open", ...(values as object) }] }),
        }),
      }),
  };
  const deps = { getClienteById: async () => clienteDetail as never, db: database as never } as never;

  it("stores a real Date when the form sends the datetime-local string", async () => {
    const response = await handleCreateOrdenServicio(
      requestWith({ clienteId: "cli-1", vehiculoId: "v1", categoria: "revisado", appointmentAt: "2026-09-10T09:00" }),
      deps,
    );

    expect(response.status).toBe(201);
    const { orden } = await response.json();
    // Serialised through JSON, so the assertion is on the instant, not the class.
    expect(new Date(orden.appointmentAt).toISOString()).toBe(new Date("2026-09-10T09:00").toISOString());
  });

  it('treats the empty field as no appointment rather than crashing', async () => {
    const response = await handleCreateOrdenServicio(
      requestWith({ clienteId: "cli-1", vehiculoId: "v1", categoria: "revisado", appointmentAt: "" }),
      deps,
    );

    expect(response.status).toBe(201);
    expect((await response.json()).orden.appointmentAt).toBeNull();
  });

  it("refuses an unparseable date in Spanish instead of 500ing", async () => {
    const response = await handleCreateOrdenServicio(
      requestWith({ clienteId: "cli-1", vehiculoId: "v1", categoria: "revisado", appointmentAt: "no-es-fecha" }),
      deps,
    );

    expect(response.status).toBe(400);
    expect((await response.json()).errors).toEqual({ appointmentAt: "Fecha inválida" });
  });
});

describe("POST /api/service-orders — a deactivated cliente (customer-management R20)", () => {
  const deactivated = {
    cliente: { id: "cli-1", deactivatedAt: new Date("2026-09-01") },
    orders: [],
    vehicles: [vehiculo1],
  } as unknown as typeof clienteDetail;

  it("maps ClienteDeactivatedError to 409, never a 500", async () => {
    const database = { transaction: vi.fn() };

    const response = await handleCreateOrdenServicio(
      requestWith({ clienteId: "cli-1", vehiculoId: "v1", categoria: "revisado" }),
      { getClienteById: async () => deactivated as never, db: database as never },
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("cliente_deactivated");
    // The refusal lands before the transaction opens.
    expect(database.transaction).not.toHaveBeenCalled();
  });
});
