import { describe, expect, it, vi } from "vitest";

import { ordenCategoriaEnum, type OrdenServicio, type Vehiculo } from "@/shared/db/schema";
import { OrderTransitionError } from "./transitions";
import {
  createOrder,
  InvalidCategoriaError,
  InvalidVehiculoError,
  normalizeOrderItems,
  OrdenServicioNotFoundError,
  transitionOrder,
  UnknownClienteError,
  updateOrder,
} from "./service";

function fakeVehiculo(overrides: Partial<Vehiculo> = {}): Vehiculo {
  return {
    id: "v1",
    clienteId: "c1",
    make: null,
    model: null,
    year: null,
    plate: "ABC111",
    deactivatedAt: null,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("normalizeOrderItems (R20 — duplicate-producto policy: MERGE quantities)", () => {
  it("merges quantities for repeated productoId occurrences into a single line item", () => {
    const result = normalizeOrderItems([
      { productoId: "p1", productName: "Filtro de aceite", quantity: 2 },
      { productoId: "p1", productName: "Filtro de aceite", quantity: 3 },
    ]);
    expect(result).toEqual([{ productoId: "p1", productName: "Filtro de aceite", quantity: 5 }]);
  });

  it("keeps distinct productoId line items separate", () => {
    const result = normalizeOrderItems([
      { productoId: "p1", productName: "Filtro de aceite", quantity: 1 },
      { productoId: "p2", productName: "Bujía", quantity: 4 },
    ]);
    expect(result).toEqual([
      { productoId: "p1", productName: "Filtro de aceite", quantity: 1 },
      { productoId: "p2", productName: "Bujía", quantity: 4 },
    ]);
  });

  it("does not merge items with no productoId (custom/off-catalog parts) even with the same name", () => {
    const result = normalizeOrderItems([
      { productName: "Pieza genérica", quantity: 1 },
      { productName: "Pieza genérica", quantity: 1 },
    ]);
    expect(result).toHaveLength(2);
  });

  it("defaults quantity to 1 when not provided", () => {
    const result = normalizeOrderItems([{ productoId: "p1", productName: "Filtro de aceite" }]);
    expect(result[0].quantity).toBe(1);
  });
});

function makeFakeTx() {
  const insertedOrders: unknown[] = [];
  const insertedItems: unknown[][] = [];
  const updateSpy = vi.fn();

  const tx = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        if (Array.isArray(values)) {
          insertedItems.push(values as unknown[]);
          return Promise.resolve(undefined);
        }
        insertedOrders.push(values);
        return {
          returning: async () => [{ id: "o1", status: "open", ...(values as Record<string, unknown>) }],
        };
      },
    }),
    update: updateSpy,
  };

  return { tx, insertedOrders, insertedItems, updateSpy };
}

describe("createOrder (R20)", () => {
  it("rejects creating an order for an unknown clienteId before touching the DB", async () => {
    const database = { transaction: vi.fn() };
    await expect(
      createOrder(
        { clienteId: "missing", vehiculoId: "v1", categoria: "revisado" },
        { getClienteById: async () => null, db: database as unknown as typeof import("@/shared/db/client").db },
      ),
    ).rejects.toBeInstanceOf(UnknownClienteError);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("creates an order with no parts attached (empty items list)", async () => {
    const { tx, insertedItems } = makeFakeTx();
    const database = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) };

    const result = await createOrder(
      { clienteId: "c1", vehiculoId: "v1", categoria: "revisado" },
      {
        getClienteById: async () => ({ cliente: { id: "c1" }, orders: [], vehicles: [fakeVehiculo()] }) as never,
        db: database as unknown as typeof import("@/shared/db/client").db,
      },
    );

    expect(result).toMatchObject({ id: "o1", clienteId: "c1" });
    expect(insertedItems).toHaveLength(0);
  });

  it("creates an order + its line items in one transaction, merging duplicate productoId quantities", async () => {
    const { tx, insertedItems } = makeFakeTx();
    const database = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) };

    await createOrder(
      {
        clienteId: "c1",
        vehiculoId: "v1",
        categoria: "revisado",
        items: [
          { productoId: "p1", productName: "Filtro de aceite", quantity: 2, unitPrice: 100 },
          { productoId: "p1", productName: "Filtro de aceite", quantity: 1, unitPrice: 100 },
        ],
      },
      {
        getClienteById: async () => ({ cliente: { id: "c1" }, orders: [], vehicles: [fakeVehiculo()] }) as never,
        db: database as unknown as typeof import("@/shared/db/client").db,
      },
    );

    expect(insertedItems).toHaveLength(1);
    expect(insertedItems[0]).toEqual([
      expect.objectContaining({ ordenId: "o1", productoId: "p1", productName: "Filtro de aceite", quantity: 3 }),
    ]);
  });

  it("never mutates producto.stock (R22) — the transaction's update() is never called", async () => {
    const { tx, updateSpy } = makeFakeTx();
    const database = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) };

    await createOrder(
      {
        clienteId: "c1",
        vehiculoId: "v1",
        categoria: "revisado",
        items: [{ productoId: "p1", productName: "Filtro de aceite", quantity: 1 }],
      },
      {
        getClienteById: async () => ({ cliente: { id: "c1" }, orders: [], vehicles: [fakeVehiculo()] }) as never,
        db: database as unknown as typeof import("@/shared/db/client").db,
      },
    );

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("threads vehiculoId and categoria into the insert (whitelist proof, task 1.8)", async () => {
    const { tx, insertedOrders } = makeFakeTx();
    const database = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) };

    await createOrder(
      { clienteId: "c1", vehiculoId: "v1", categoria: "mant_preventivo" },
      {
        getClienteById: async () => ({ cliente: { id: "c1" }, orders: [], vehicles: [fakeVehiculo()] }) as never,
        db: database as unknown as typeof import("@/shared/db/client").db,
      },
    );

    expect(insertedOrders[0]).toMatchObject({ vehiculoId: "v1", categoria: "mant_preventivo" });
  });

  /**
   * Whitelist pin (task 1.8): `createOrder`'s `.values({...})` map is the ONLY
   * thing preventing a create-time `hallazgos` from being stored — the route
   * passes the raw body straight through with no whitelist of its own
   * (route.ts:16). A test that spread `...input` into the insert instead of
   * naming fields would pass this test wrongly if it merely checked the
   * RETURNED order (the fake tx echoes back whatever it was given) — so this
   * asserts what was actually handed to `.values()`, not the result.
   */
  it("never passes hallazgos through to the insert, even when the caller's payload carries it (task 1.8)", async () => {
    const { tx, insertedOrders } = makeFakeTx();
    const database = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) };

    await createOrder(
      { clienteId: "c1", vehiculoId: "v1", categoria: "revisado", hallazgos: "no debería llegar" } as never,
      {
        getClienteById: async () => ({ cliente: { id: "c1" }, orders: [], vehicles: [fakeVehiculo()] }) as never,
        db: database as unknown as typeof import("@/shared/db/client").db,
      },
    );

    expect(insertedOrders[0]).not.toHaveProperty("hallazgos");
  });

  describe("categoria validation (C4, GGA round 3)", () => {
    const detail = { cliente: { id: "c1" }, orders: [], vehicles: [fakeVehiculo()] };

    it("rejects a categoria outside the enum, so Postgres 22P02 never becomes a 500", async () => {
      const database = { transaction: vi.fn() };
      const promise = createOrder(
        { clienteId: "c1", vehiculoId: "v1", categoria: "cualquier_cosa" as never },
        { getClienteById: async () => detail as never, db: database as never },
      );
      await expect(promise).rejects.toBeInstanceOf(InvalidCategoriaError);
      // The exact copy, not a "contains a letter" regex: this assertion exists
      // to go red the day someone ships English at the user, and /[a-z]/i would
      // happily pass on "Invalid categoria".
      await expect(promise).rejects.toMatchObject({ errors: { categoria: "Elegí un tipo de servicio válido" } });
      expect(database.transaction).not.toHaveBeenCalled();
    });

    it("rejects a MISSING categoria — the same defect as a bogus one, arriving as 23502 instead of 22P02", async () => {
      const database = { transaction: vi.fn() };
      await expect(
        createOrder(
          { clienteId: "c1", vehiculoId: "v1" } as never,
          { getClienteById: async () => detail as never, db: database as never },
        ),
      ).rejects.toBeInstanceOf(InvalidCategoriaError);
      expect(database.transaction).not.toHaveBeenCalled();
    });

    it("accepts every value the enum actually declares", async () => {
      for (const value of ordenCategoriaEnum.enumValues) {
        const database = {
          transaction: async (cb: (tx: unknown) => unknown) =>
            cb({ insert: () => ({ values: (v: object) => ({ returning: async () => [{ id: "o1", ...v }] }) }) }),
        };
        const orden = await createOrder(
          { clienteId: "c1", vehiculoId: "v1", categoria: value },
          { getClienteById: async () => detail as never, db: database as never },
        );
        expect(orden.categoria).toBe(value);
      }
    });
  });

  describe("vehicle validation (C4, R20)", () => {
    it("rejects a vehiculoId that does not correspond to any vehiculo row, with a Spanish error", async () => {
      const database = { transaction: vi.fn() };
      const promise = createOrder(
        { clienteId: "c1", vehiculoId: "missing", categoria: "revisado" },
        {
          getClienteById: async () => ({ cliente: { id: "c1" }, orders: [], vehicles: [fakeVehiculo()] }) as never,
          db: database as unknown as typeof import("@/shared/db/client").db,
        },
      );
      await expect(promise).rejects.toBeInstanceOf(InvalidVehiculoError);
      await expect(promise).rejects.toMatchObject({ errors: { vehiculoId: "Seleccioná un vehículo válido de este cliente" } });
      expect(database.transaction).not.toHaveBeenCalled();
    });

    it("rejects a vehiculo belonging to a different customer — cross-ownership, not merely a missing-record check", async () => {
      const database = { transaction: vi.fn() };
      await expect(
        createOrder(
          { clienteId: "c-a", vehiculoId: "v-belongs-to-b", categoria: "revisado" },
          {
            // clienteDetail.vehicles is customer A's OWN collection — a vehicle
            // id belonging to customer B is simply absent from it, exactly as it
            // would be from a real DB read scoped by clienteId.
            getClienteById: async () => ({ cliente: { id: "c-a" }, orders: [], vehicles: [fakeVehiculo({ id: "v-a" })] }) as never,
            db: database as unknown as typeof import("@/shared/db/client").db,
          },
        ),
      ).rejects.toBeInstanceOf(InvalidVehiculoError);
      expect(database.transaction).not.toHaveBeenCalled();
    });

    it("rejects an inactive (deactivated) vehicle — the picker cannot offer one, so create-time is a deliberate tightening", async () => {
      const database = { transaction: vi.fn() };
      await expect(
        createOrder(
          { clienteId: "c1", vehiculoId: "v1", categoria: "revisado" },
          {
            getClienteById: async () =>
              ({ cliente: { id: "c1" }, orders: [], vehicles: [fakeVehiculo({ deactivatedAt: new Date("2026-01-05") })] }) as never,
            db: database as unknown as typeof import("@/shared/db/client").db,
          },
        ),
      ).rejects.toBeInstanceOf(InvalidVehiculoError);
      expect(database.transaction).not.toHaveBeenCalled();
    });
  });
});

describe("updateOrder", () => {
  it("throws OrdenServicioNotFoundError for a missing order", async () => {
    await expect(updateOrder("missing", { description: "x" }, { getById: async () => null })).rejects.toBeInstanceOf(
      OrdenServicioNotFoundError,
    );
  });

  it("persists the patch fields", async () => {
    const current = { orden: { id: "o1", status: "open" } as unknown as OrdenServicio, items: [] };
    const database = {
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => ({ returning: async () => [{ ...current.orden, ...patch }] }),
        }),
      }),
    };

    const result = await updateOrder(
      "o1",
      { description: "Cambio de aceite" },
      { getById: async () => current, db: database as unknown as typeof import("@/shared/db/client").db },
    );

    expect(result).toMatchObject({ id: "o1", description: "Cambio de aceite" });
  });

  /**
   * Task 2.2 — widens `UpdateOrdenServicioPatch` for `categoria` + the 3 note
   * fields (`hallazgos`/`recomendaciones`/`observaciones`), leaving every
   * other field's behavior untouched. `updateOrder` already applies `patch`
   * generically via `.set(patch)`, so the meaningful assertion is that the
   * TYPE accepts these fields (a stray property here is a `tsc` error before
   * it is a runtime one) and that all four values actually reach the result.
   */
  it("persists categoria and the 3 note fields (task 2.2)", async () => {
    const current = { orden: { id: "o1", status: "open" } as unknown as OrdenServicio, items: [] };
    const database = {
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => ({ returning: async () => [{ ...current.orden, ...patch }] }),
        }),
      }),
    };

    const result = await updateOrder(
      "o1",
      {
        categoria: "reparacion",
        hallazgos: "Fuga de aceite en el cárter",
        recomendaciones: "Cambiar empaque del cárter",
        observaciones: "Cliente notificado por WhatsApp",
      },
      { getById: async () => current, db: database as unknown as typeof import("@/shared/db/client").db },
    );

    expect(result).toMatchObject({
      id: "o1",
      categoria: "reparacion",
      hallazgos: "Fuga de aceite en el cárter",
      recomendaciones: "Cambiar empaque del cárter",
      observaciones: "Cliente notificado por WhatsApp",
    });
  });

  it("leaves description untouched when only categoria is patched (task 2.2 — other fields untouched)", async () => {
    const current = {
      orden: { id: "o1", status: "open", description: "Original" } as unknown as OrdenServicio,
      items: [],
    };
    const database = {
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => ({ returning: async () => [{ ...current.orden, ...patch }] }),
        }),
      }),
    };

    const result = await updateOrder(
      "o1",
      { categoria: "instalacion" },
      { getById: async () => current, db: database as unknown as typeof import("@/shared/db/client").db },
    );

    expect(result).toMatchObject({ id: "o1", description: "Original", categoria: "instalacion" });
  });
});

describe("transitionOrder (R21)", () => {
  it("throws OrdenServicioNotFoundError for a missing order", async () => {
    await expect(transitionOrder("missing", "in_progress", { getById: async () => null })).rejects.toBeInstanceOf(
      OrdenServicioNotFoundError,
    );
  });

  it("rejects an invalid transition (open -> done) without writing to the DB", async () => {
    const current = { orden: { id: "o1", status: "open" } as unknown as OrdenServicio, items: [] };
    const updateFn = vi.fn();
    const database = { update: updateFn };

    await expect(
      transitionOrder("o1", "done", {
        getById: async () => current,
        db: database as unknown as typeof import("@/shared/db/client").db,
      }),
    ).rejects.toBeInstanceOf(OrderTransitionError);
    expect(updateFn).not.toHaveBeenCalled();
  });

  it("open -> in_progress updates status without touching completedAt", async () => {
    const current = { orden: { id: "o1", status: "open" } as unknown as OrdenServicio, items: [] };
    let capturedPatch: Record<string, unknown> = {};
    const database = {
      update: () => ({
        set: (patch: Record<string, unknown>) => {
          capturedPatch = patch;
          return { where: () => ({ returning: async () => [{ ...current.orden, ...patch }] }) };
        },
      }),
    };

    const result = await transitionOrder("o1", "in_progress", {
      getById: async () => current,
      db: database as unknown as typeof import("@/shared/db/client").db,
    });

    expect(result.status).toBe("in_progress");
    expect(capturedPatch).not.toHaveProperty("completedAt");
  });

  it("in_progress -> done sets completedAt", async () => {
    const current = { orden: { id: "o1", status: "in_progress" } as unknown as OrdenServicio, items: [] };
    const fixedNow = new Date("2026-07-26T12:00:00Z");
    const database = {
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => ({ returning: async () => [{ ...current.orden, ...patch }] }),
        }),
      }),
    };

    const result = await transitionOrder("o1", "done", {
      getById: async () => current,
      db: database as unknown as typeof import("@/shared/db/client").db,
      now: () => fixedNow,
      // No cliente found for this fixture's clienteId (undefined) — the
      // service_due reminder wiring below no-ops gracefully; this test only
      // asserts the completedAt behavior, not the reminder wiring (see the
      // "reminder wiring (R23, Phase 4 task 4.5)" describe block below).
      getClienteById: async () => null,
    });

    expect(result.status).toBe("done");
    expect(result.completedAt).toEqual(fixedNow);
  });

  it("calls the onTransitioned seam after persisting (Phase 4 hook point)", async () => {
    const current = { orden: { id: "o1", status: "in_progress" } as unknown as OrdenServicio, items: [] };
    const database = {
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => ({ returning: async () => [{ ...current.orden, ...patch }] }),
        }),
      }),
    };
    const onTransitioned = vi.fn();
    const cancelRemindersForOrder = vi.fn().mockResolvedValue(undefined);

    await transitionOrder("o1", "cancelled", {
      getById: async () => current,
      db: database as unknown as typeof import("@/shared/db/client").db,
      onTransitioned,
      cancelRemindersForOrder,
    });

    expect(onTransitioned).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }), "in_progress", "cancelled");
  });
});

describe("reminder wiring (R23, Phase 4 task 4.5) — via injected fakes, no real DB/pg-boss", () => {
  const clienteRow = {
    id: "c1",
    name: "Juan Perez",
    phone: "+5491122334455",
    email: "juan@example.com",
    whatsappOptOut: false,
    emailOptOut: false,
  } as unknown as import("@/shared/db/schema").Cliente;

  it("createOrder schedules an appointment reminder when appointmentAt is given", async () => {
    const { tx } = makeFakeTx();
    const database = {
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
      insert: () => ({ values: () => ({ returning: async () => [{ id: "rem-1" }] }) }),
    };
    const scheduleReminder = vi.fn().mockResolvedValue("job-1");

    await createOrder(
      { clienteId: "c1", vehiculoId: "v1", categoria: "revisado", appointmentAt: new Date("2026-08-01T10:00:00.000Z") },
      {
        getClienteById: async () => ({ cliente: clienteRow, orders: [], vehicles: [fakeVehiculo()] }),
        db: database as unknown as typeof import("@/shared/db/client").db,
        now: () => new Date("2026-07-26T12:00:00.000Z"),
        scheduleReminder,
      },
    );

    expect(scheduleReminder).toHaveBeenCalled();
  });

  it("createOrder does NOT schedule any reminder when no appointmentAt is given", async () => {
    const { tx } = makeFakeTx();
    const database = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) };
    const scheduleReminder = vi.fn();

    await createOrder(
      { clienteId: "c1", vehiculoId: "v1", categoria: "revisado" },
      {
        getClienteById: async () => ({ cliente: clienteRow, orders: [], vehicles: [fakeVehiculo()] }),
        db: database as unknown as typeof import("@/shared/db/client").db,
        scheduleReminder,
      },
    );

    expect(scheduleReminder).not.toHaveBeenCalled();
  });

  it("transitionOrder -> done schedules a service_due reminder", async () => {
    const current = { orden: { id: "o1", clienteId: "c1", status: "in_progress" } as unknown as OrdenServicio, items: [] };
    const database = {
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => ({ returning: async () => [{ ...current.orden, ...patch }] }),
        }),
      }),
      insert: () => ({ values: () => ({ returning: async () => [{ id: "rem-2" }] }) }),
    };
    const scheduleReminder = vi.fn().mockResolvedValue("job-2");

    await transitionOrder("o1", "done", {
      getById: async () => current,
      db: database as unknown as typeof import("@/shared/db/client").db,
      now: () => new Date("2026-07-26T12:00:00.000Z"),
      getClienteById: async () => ({ cliente: clienteRow, orders: [], vehicles: [] }),
      scheduleReminder,
    });

    expect(scheduleReminder).toHaveBeenCalled();
  });

  it("transitionOrder -> cancelled cancels all pending reminders for the order", async () => {
    const current = { orden: { id: "o1", clienteId: "c1", status: "open" } as unknown as OrdenServicio, items: [] };
    const database = {
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => ({ returning: async () => [{ ...current.orden, ...patch }] }),
        }),
      }),
    };
    const cancelRemindersForOrder = vi.fn().mockResolvedValue(undefined);

    await transitionOrder("o1", "cancelled", {
      getById: async () => current,
      db: database as unknown as typeof import("@/shared/db/client").db,
      cancelRemindersForOrder,
    });

    expect(cancelRemindersForOrder).toHaveBeenCalledWith("o1", undefined, expect.anything());
  });

  it("updateOrder reschedules the appointment reminder when appointmentAt changes: cancels the old one, schedules a new one", async () => {
    const current = {
      orden: { id: "o1", clienteId: "c1", appointmentAt: new Date("2026-08-01T10:00:00.000Z") } as unknown as OrdenServicio,
      items: [],
    };
    const newAppointmentAt = new Date("2026-08-05T10:00:00.000Z");
    const database = {
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => ({ returning: async () => [{ ...current.orden, ...patch }] }),
        }),
      }),
      insert: () => ({ values: () => ({ returning: async () => [{ id: "rem-3" }] }) }),
    };
    const cancelRemindersForOrder = vi.fn().mockResolvedValue(undefined);
    const scheduleReminder = vi.fn().mockResolvedValue("job-3");

    await updateOrder(
      "o1",
      { appointmentAt: newAppointmentAt },
      {
        getById: async () => current,
        db: database as unknown as typeof import("@/shared/db/client").db,
        now: () => new Date("2026-07-26T12:00:00.000Z"),
        getClienteById: async () => ({ cliente: clienteRow, orders: [], vehicles: [] }),
        cancelRemindersForOrder,
        scheduleReminder,
      },
    );

    expect(cancelRemindersForOrder).toHaveBeenCalledWith("o1", "appointment", expect.anything());
    expect(scheduleReminder).toHaveBeenCalled();
  });

  it("updateOrder does NOT touch reminders when appointmentAt is unchanged", async () => {
    const appointmentAt = new Date("2026-08-01T10:00:00.000Z");
    const current = { orden: { id: "o1", clienteId: "c1", appointmentAt } as unknown as OrdenServicio, items: [] };
    const database = {
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => ({ returning: async () => [{ ...current.orden, ...patch }] }),
        }),
      }),
    };
    const cancelRemindersForOrder = vi.fn();
    const scheduleReminder = vi.fn();

    await updateOrder(
      "o1",
      { description: "solo cambio de nota" },
      {
        getById: async () => current,
        db: database as unknown as typeof import("@/shared/db/client").db,
        cancelRemindersForOrder,
        scheduleReminder,
      },
    );

    expect(cancelRemindersForOrder).not.toHaveBeenCalled();
    expect(scheduleReminder).not.toHaveBeenCalled();
  });
});
