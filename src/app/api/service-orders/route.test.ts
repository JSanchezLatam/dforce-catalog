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

/**
 * D7/D10 — the create payload, entered at the ROUTE with a JSON round trip.
 *
 * The shape is not decoration. `POST /api/service-orders` shipped unable to
 * save anything at all: the route spread the body into `CreateOrdenServicioInput`,
 * whose `appointmentAt` is declared `Date | null`, and JSON carries no Date, so
 * Drizzle got the form's `datetime-local` string and died on
 * `value.toISOString is not a function`. Every unit test passed, because every
 * unit test handed the function an object it had typed itself.
 *
 * So the fixture is the form's own state, put through
 * `JSON.parse(JSON.stringify(...))` before it is sent. A hand-typed literal
 * would let a `Date` — or a number, or a `null` the form cannot produce —
 * survive into the assertion; the round trip guarantees the test can only ever
 * carry what the wire can carry. And the assertions are on what the insert
 * seam RECEIVED, never on the call resolving: the fake tx accepts anything.
 */
describe("POST /api/service-orders — the form's payload, round-tripped through JSON (D7/D10)", () => {
  /** Exactly the object `ServiceOrderForm.handleSubmit` stringifies in create mode. */
  const FORM_STATE = {
    clienteId: "cli-1",
    vehiculoId: "v1",
    categoria: "revisado",
    description: "Trae ruido al frenar",
    observaciones: "El cliente espera en el taller",
    appointmentAt: new Date("2026-09-10T09:00").toISOString(),
  };

  /** The one thing standing between a hand-typed literal and the wire. */
  function wire(state: Record<string, unknown>) {
    return JSON.parse(JSON.stringify(state));
  }

  function capturingDb() {
    const inserts: unknown[] = [];
    const database = {
      transaction: async (cb: (tx: unknown) => unknown) =>
        cb({
          insert: () => ({
            values: (values: unknown) => {
              inserts.push(values);
              // An `ordenServicioItem` insert passes an ARRAY and never calls
              // `.returning()`, so both shapes have to survive here — a fake
              // that only answers the order insert would hide the second one.
              if (Array.isArray(values)) return Promise.resolve(undefined);
              return { returning: async () => [{ id: "o1", status: "open", ...(values as object) }] };
            },
          }),
        }),
    };
    return { database, inserts };
  }

  const deps = (database: unknown) => ({ getClienteById: async () => clienteDetail as never, db: database as never });

  /**
   * The sibling route refuses both of these on the SAME columns
   * (`[id]/route.ts`'s `NULLABLE_TEXT_FIELDS` loop): "A type check alone lets
   * any authenticated user PATCH megabytes straight into Postgres." Create had
   * no such guard, so the identical payload was a 400 one route over and a 201
   * here — `pg` stringifies an object, so `{ evil: 1 }` landed as
   * `{"evil":1}` in an unbounded `text` column.
   *
   * `wire()` cannot catch this on its own: `JSON.parse(JSON.stringify(...))`
   * of a hand-typed literal only ever carries the strings the fixture author
   * wrote. Nothing in the suite sent a non-string until these two cases.
   */
  it("refuses a non-string observaciones with 400, without reaching the insert", async () => {
    const { database, inserts } = capturingDb();

    const response = await handleCreateOrdenServicio(
      requestWith(wire({ ...FORM_STATE, observaciones: { evil: 1 } })),
      deps(database),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ errors: { observaciones: "Valor inválido" } });
    expect(inserts).toHaveLength(0);
  });

  it("refuses an over-long description with 400, without reaching the insert", async () => {
    const { database, inserts } = capturingDb();

    const response = await handleCreateOrdenServicio(
      requestWith(wire({ ...FORM_STATE, description: "x".repeat(5001) })),
      deps(database),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ errors: { description: "Texto demasiado largo" } });
    expect(inserts).toHaveLength(0);
  });

  // `null` clears the field and is not the same as smuggling an object —
  // the same distinction `[id]/route.test.ts` already pins on the patch side.
  it("still accepts null on a note field", async () => {
    const { database, inserts } = capturingDb();

    const response = await handleCreateOrdenServicio(
      requestWith(wire({ ...FORM_STATE, observaciones: null })),
      deps(database),
    );

    expect(response.status).toBe(201);
    expect((inserts[0] as Record<string, unknown>).observaciones).toBeNull();
  });

  it("threads observaciones through to the insert seam", async () => {
    const { database, inserts } = capturingDb();

    const response = await handleCreateOrdenServicio(requestWith(wire(FORM_STATE)), deps(database));

    expect(response.status).toBe(201);
    const values = inserts[0] as Record<string, unknown>;
    expect(values.observaciones).toBe("El cliente espera en el taller");
    expect(values.description).toBe("Trae ruido al frenar");
    // The original defect, pinned in the same shape: a string on the wire has
    // to arrive at Drizzle as a Date, or nothing saves at all.
    expect(values.appointmentAt).toBeInstanceOf(Date);
  });

  it("stores observaciones and drops hallazgos/recomendaciones from the SAME payload", async () => {
    const { database, inserts } = capturingDb();

    const response = await handleCreateOrdenServicio(
      requestWith(wire({ ...FORM_STATE, hallazgos: "no debería llegar", recomendaciones: "tampoco" })),
      deps(database),
    );

    expect(response.status).toBe(201);
    const values = inserts[0] as Record<string, unknown>;
    expect(values.observaciones).toBe("El cliente espera en el taller");
    expect(values).not.toHaveProperty("hallazgos");
    expect(values).not.toHaveProperty("recomendaciones");
  });

  it("writes no ordenServicioItem row, even for a body that still carries items", async () => {
    const { database, inserts } = capturingDb();

    const response = await handleCreateOrdenServicio(
      requestWith(
        wire({ ...FORM_STATE, items: [{ productoId: "p1", productName: "Filtro de aceite", quantity: 2 }] }),
      ),
      deps(database),
    );

    expect(response.status).toBe(201);
    // One insert, and it is the order. `ordenServicioItem`'s only writer is
    // gone, so the line-item insert is unreachable from any caller.
    expect(inserts).toHaveLength(1);
    expect(Array.isArray(inserts[0])).toBe(false);
  });
});
