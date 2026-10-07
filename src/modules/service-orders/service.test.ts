import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { ClienteDeactivatedError } from "@/modules/customers/service";

import { ordenCategoriaEnum, ordenServicioCorreccion, type Vehiculo } from "@/shared/db/schema";
import { OrderClosedError, OrderEditForbiddenError } from "./order-lock";
import { orderScope, SYSTEM_SCOPE } from "./scope";
import { InvalidTecnicoError } from "./assignments";
import { OrderTransitionError, TransitionForbiddenError } from "./transitions";
import {
  createOrder,
  InvalidCategoriaError,
  InvalidVehiculoError,
  OrdenServicioNotFoundError,
  transitionOrder,
  UnknownClienteError,
  updateOrder,
  type UpdateOrdenServicioPatch,
} from "./service";

function fakeVehiculo(overrides: Partial<Vehiculo> = {}): Vehiculo {
  return {
    id: "v1",
    clienteId: "c1",
    make: null,
    model: null,
    year: null,
    plate: "ABC111",
    chasis: null,
    colorPrimario: null,
    colorSecundario: null,
    estilo: null,
    motor: null,
    numeroUnidad: null,
    placaRenovacionMes: null,
    placaMunicipio: null,
    seguroVence: null,
    deactivatedAt: null,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeFakeTx() {
  const insertedOrders: unknown[] = [];
  const insertedItems: unknown[][] = [];
  const updateSpy = vi.fn();

  const tx = {
    insert: () => ({
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

  it("creates an order and writes no line item — ordenServicioItem has no writer left (D7)", async () => {
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

  it("never mutates producto.stock (R22) — the transaction's update() is never called", async () => {
    const { tx, updateSpy } = makeFakeTx();
    const database = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) };

    await createOrder(
      { clienteId: "c1", vehiculoId: "v1", categoria: "revisado" },
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
      {
        clienteId: "c1",
        vehiculoId: "v1",
        categoria: "revisado",
        observaciones: "el cliente espera",
        hallazgos: "no debería llegar",
      } as never,
      {
        getClienteById: async () => ({ cliente: { id: "c1" }, orders: [], vehicles: [fakeVehiculo()] }) as never,
        db: database as unknown as typeof import("@/shared/db/client").db,
      },
    );

    expect(insertedOrders[0]).not.toHaveProperty("hallazgos");
    // From the SAME payload, and the pair is the point: `observaciones` is
    // now a create-time field while findings stay patch-only (D7).
    expect(insertedOrders[0]).toMatchObject({ observaciones: "el cliente espera" });
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

const OPEN_ROW = {
  id: "o1",
  clienteId: "c1",
  status: "open",
  categoria: "mant_preventivo",
  description: null,
  appointmentAt: null,
  completedAt: null,
  hallazgos: null,
  recomendaciones: null,
  observaciones: null,
  kilometraje: null,
};

/**
 * A fake database whose transaction hands out a tx shaped like the real builders
 * (`select().from().where().for()`, `update().set().where().returning()`,
 * `insert().values()`), recording what each statement received. `committed`
 * flips only when the callback returns, so a test can ask "was this step after
 * commit?". `auditOutside` catches an audit row written through the pool
 * instead of the transaction.
 */
function lockedDb(order: Record<string, unknown> | null) {
  const log = {
    locks: [] as unknown[],
    wheres: [] as unknown[],
    sets: [] as Record<string, unknown>[],
    audit: [] as Record<string, unknown>[],
    auditOutside: [] as unknown[],
    committed: false,
  };
  const tx = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          log.wheres.push(condition);
          return {
            for: (mode: unknown) => {
              log.locks.push(mode);
              return Promise.resolve(order ? [order] : []);
            },
          };
        },
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        log.sets.push(patch);
        return { where: () => ({ returning: async () => [{ ...order, ...patch }] }) };
      },
    }),
    insert: () => ({
      values: async (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        log.audit.push(...[rows].flat());
      },
    }),
  };
  const database = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const result = await fn(tx);
      log.committed = true;
      return result;
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table === ordenServicioCorreccion) log.auditOutside.push(values);
        return { returning: async () => [{ id: "rem", ...values }] };
      },
    }),
  };
  return { database: database as unknown as typeof import("@/shared/db/client").db, log };
}

const GRANT = { correctorId: "admin-1" };

describe("updateOrder", () => {
  it("throws OrdenServicioNotFoundError for a missing order", async () => {
    const { database } = lockedDb(null);
    await expect(updateOrder("missing", { description: "x" }, { db: database, scope: SYSTEM_SCOPE, role: "administrador" })).rejects.toBeInstanceOf(
      OrdenServicioNotFoundError,
    );
  });

  it("takes the row lock (FOR UPDATE) before writing, in one transaction", async () => {
    const { database, log } = lockedDb(OPEN_ROW);

    await updateOrder("o1", { description: "Cambio de aceite" }, { db: database, scope: SYSTEM_SCOPE, role: "administrador" });

    expect(log.locks).toEqual(["update"]);
    expect(log.sets).toEqual([{ description: "Cambio de aceite" }]);
  });

  it("persists the patch fields", async () => {
    const { database } = lockedDb(OPEN_ROW);

    const result = await updateOrder("o1", { description: "Cambio de aceite" }, { db: database, scope: SYSTEM_SCOPE, role: "administrador" });

    expect(result).toMatchObject({ id: "o1", description: "Cambio de aceite" });
  });

  /**
   * Task 2.2 — widens `UpdateOrdenServicioPatch` for `categoria` + the 3 note
   * fields, leaving every other field's behavior untouched.
   */
  it("persists categoria and the 3 note fields (task 2.2)", async () => {
    const { database } = lockedDb(OPEN_ROW);

    const result = await updateOrder(
      "o1",
      {
        categoria: "reparacion",
        hallazgos: "Fuga de aceite en el cárter",
        recomendaciones: "Cambiar empaque del cárter",
        observaciones: "Cliente notificado por WhatsApp",
      },
      { db: database, scope: SYSTEM_SCOPE, role: "administrador" },
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
    const { database } = lockedDb({ ...OPEN_ROW, description: "Original" });

    const result = await updateOrder("o1", { categoria: "instalacion" }, { db: database, scope: SYSTEM_SCOPE, role: "administrador" });

    expect(result).toMatchObject({ id: "o1", description: "Original", categoria: "instalacion" });
  });

  it("refuses a closed order read from the LOCKED row when no correction is granted, writing nothing", async () => {
    // The status is whatever the lock returned: there is no earlier read to go stale.
    const { database, log } = lockedDb({ ...OPEN_ROW, status: "done" });

    await expect(
      updateOrder("o1", { hallazgos: "x" }, { db: database, scope: SYSTEM_SCOPE, role: "administrador" }),
    ).rejects.toBeInstanceOf(OrderClosedError);
    expect(log.sets).toEqual([]);
    expect(log.audit).toEqual([]);
  });

  it("refuses a tecnico on an open order with OrderEditForbiddenError, writing nothing", async () => {
    const { database, log } = lockedDb(OPEN_ROW);

    await expect(updateOrder("o1", { hallazgos: "x" }, { db: database, scope: SYSTEM_SCOPE, role: "tecnico" })).rejects.toBeInstanceOf(
      OrderEditForbiddenError,
    );
    expect(log.sets).toEqual([]);
  });

  it("writes the fields and the audit rows in ONE transaction on a closed order with a grant", async () => {
    const { database, log } = lockedDb({ ...OPEN_ROW, status: "done" });

    await updateOrder("o1", { hallazgos: "nuevo", observaciones: null }, { db: database, scope: SYSTEM_SCOPE, role: "administrador", correction: GRANT });

    expect(log.sets).toEqual([{ hallazgos: "nuevo", observaciones: null }]);
    // `observaciones` was null before and is null after: no row for it.
    expect(log.audit).toEqual([
      { ordenId: "o1", userId: "admin-1", field: "hallazgos", oldValue: null, newValue: "nuevo" },
    ]);
    expect(log.auditOutside).toEqual([]);
  });

  it("writes no audit row for an edit of an OPEN order, even when a grant is present", async () => {
    const { database, log } = lockedDb(OPEN_ROW);

    await updateOrder("o1", { hallazgos: "nuevo" }, { db: database, scope: SYSTEM_SCOPE, role: "administrador", correction: GRANT });

    expect(log.sets).toEqual([{ hallazgos: "nuevo" }]);
    expect(log.audit).toEqual([]);
  });

  it("cannot be handed status or completedAt: the patch type excludes them", () => {
    // @ts-expect-error status is not patchable; a correction never reopens an order
    const status: UpdateOrdenServicioPatch = { status: "open" };
    // @ts-expect-error completedAt is not patchable either
    const completedAt: UpdateOrdenServicioPatch = { completedAt: new Date() };
    expect([status, completedAt]).toHaveLength(2);
  });
});

describe("transitionOrder (R21)", () => {
  const rowAt = (status: "open" | "in_progress") => ({ ...OPEN_ROW, status });

  it("throws OrdenServicioNotFoundError for a missing order", async () => {
    const { database } = lockedDb(null);
    await expect(transitionOrder("missing", "in_progress", { scope: SYSTEM_SCOPE, canAssign: true, db: database })).rejects.toBeInstanceOf(
      OrdenServicioNotFoundError,
    );
  });

  it("takes the row lock (FOR UPDATE) before writing, in one transaction", async () => {
    const { database, log } = lockedDb(rowAt("open"));

    await transitionOrder("o1", "in_progress", { scope: SYSTEM_SCOPE, canAssign: true, db: database });

    expect(log.locks).toEqual(["update"]);
    expect(log.sets).toEqual([{ status: "in_progress" }]);
  });

  it("rejects an invalid transition (open -> done) without writing to the DB", async () => {
    const { database, log } = lockedDb(rowAt("open"));

    await expect(transitionOrder("o1", "done", { scope: SYSTEM_SCOPE, canAssign: true, db: database })).rejects.toBeInstanceOf(OrderTransitionError);
    expect(log.sets).toEqual([]);
  });

  it.each(["done", "cancelled"] as const)(
    "refuses a transition out of a locked %s order with OrderTransitionError and no write",
    async (status) => {
      const { database, log } = lockedDb({ ...OPEN_ROW, status });

      await expect(transitionOrder("o1", "in_progress", { scope: SYSTEM_SCOPE, canAssign: true, db: database })).rejects.toBeInstanceOf(OrderTransitionError);
      expect(log.locks).toEqual(["update"]);
      expect(log.sets).toEqual([]);
    },
  );

  it("open -> in_progress updates status without touching completedAt", async () => {
    const { database, log } = lockedDb(rowAt("open"));

    const result = await transitionOrder("o1", "in_progress", { scope: SYSTEM_SCOPE, canAssign: true, db: database });

    expect(result.status).toBe("in_progress");
    expect(log.sets[0]).not.toHaveProperty("completedAt");
  });

  it("in_progress -> done sets completedAt", async () => {
    const { database } = lockedDb(rowAt("in_progress"));
    const fixedNow = new Date("2026-07-26T12:00:00Z");

    const result = await transitionOrder("o1", "done", { scope: SYSTEM_SCOPE, canAssign: true,
      db: database,
      now: () => fixedNow,
      // No cliente found: the service_due wiring no-ops; this test only asserts completedAt.
      getClienteById: async () => null,
    });

    expect(result.status).toBe("done");
    expect(result.completedAt).toEqual(fixedNow);
  });

  it("calls the onTransitioned seam after persisting (Phase 4 hook point)", async () => {
    const { database } = lockedDb(rowAt("in_progress"));
    const onTransitioned = vi.fn();
    const cancelRemindersForOrder = vi.fn().mockResolvedValue(undefined);

    await transitionOrder("o1", "cancelled", { scope: SYSTEM_SCOPE, canAssign: true, db: database, onTransitioned, cancelRemindersForOrder });

    expect(onTransitioned).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }), "in_progress", "cancelled");
  });

  it("runs the reminder side effects only AFTER the transaction commits", async () => {
    const { database, log } = lockedDb(rowAt("in_progress"));
    let committedWhenCancelled: boolean | undefined;
    const cancelRemindersForOrder = vi.fn(async () => {
      committedWhenCancelled = log.committed;
    });

    await transitionOrder("o1", "cancelled", { scope: SYSTEM_SCOPE, canAssign: true, db: database, cancelRemindersForOrder });

    expect(committedWhenCancelled).toBe(true);
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

  /**
   * `categoria` is spelled out because it is `.notNull()` and the gate reads
   * it: the fixture used to omit it and the cast hid that, which is the "a
   * mock more convenient than reality tests the mock" case AGENTS.md names.
   * Omitted, `order.categoria` is `undefined` and no reminder is scheduled —
   * for the wrong reason.
   */
  it("transitionOrder -> done schedules a service_due reminder", async () => {
    const { database } = lockedDb({ ...OPEN_ROW, clienteId: "c1", status: "in_progress", categoria: "mant_preventivo" });
    const scheduleReminder = vi.fn().mockResolvedValue("job-2");

    await transitionOrder("o1", "done", { scope: SYSTEM_SCOPE, canAssign: true,
      db: database,
      now: () => new Date("2026-07-26T12:00:00.000Z"),
      getClienteById: async () => ({ cliente: clienteRow, orders: [], vehicles: [] }),
      scheduleReminder,
    });

    expect(scheduleReminder).toHaveBeenCalled();
  });

  /**
   * The sibling, and the one that proves the gate REACHES this path.
   * `planReminders`' own test covers the predicate; this covers the wiring —
   * `transitionOrder` still calls `planAndScheduleReminders` unconditionally,
   * so without the gate downstream an excluded order would still be booked.
   *
   * The example was `revisado` until it earned a 365-day `service_due` of its
   * own; `instalacion` is now the category that genuinely gets none.
   */
  it("transitionOrder -> done schedules NOTHING for a category the rule excludes", async () => {
    const { database } = lockedDb({ ...OPEN_ROW, clienteId: "c1", status: "in_progress", categoria: "instalacion" });
    const scheduleReminder = vi.fn().mockResolvedValue("job-2");

    await transitionOrder("o1", "done", { scope: SYSTEM_SCOPE, canAssign: true,
      db: database,
      now: () => new Date("2026-07-26T12:00:00.000Z"),
      getClienteById: async () => ({ cliente: clienteRow, orders: [], vehicles: [] }),
      scheduleReminder,
    });

    expect(scheduleReminder).not.toHaveBeenCalled();
  });

  it("transitionOrder -> cancelled cancels all pending reminders for the order", async () => {
    const { database } = lockedDb({ ...OPEN_ROW, clienteId: "c1", status: "open" });
    const cancelRemindersForOrder = vi.fn().mockResolvedValue(undefined);

    await transitionOrder("o1", "cancelled", { scope: SYSTEM_SCOPE, canAssign: true,
      db: database,
      cancelRemindersForOrder,
    });

    expect(cancelRemindersForOrder).toHaveBeenCalledWith("o1", undefined, expect.anything());
  });

  it("updateOrder reschedules the appointment reminder when appointmentAt changes: cancels the old one, schedules a new one", async () => {
    const { database } = lockedDb({ ...OPEN_ROW, appointmentAt: new Date("2026-08-01T10:00:00.000Z") });
    const cancelRemindersForOrder = vi.fn().mockResolvedValue(undefined);
    const scheduleReminder = vi.fn().mockResolvedValue("job-3");

    await updateOrder(
      "o1",
      { appointmentAt: new Date("2026-08-05T10:00:00.000Z") },
      {
        db: database,
        scope: SYSTEM_SCOPE, role: "administrador",
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
    const { database } = lockedDb({ ...OPEN_ROW, appointmentAt: new Date("2026-08-01T10:00:00.000Z") });
    const cancelRemindersForOrder = vi.fn();
    const scheduleReminder = vi.fn();

    await updateOrder(
      "o1",
      { description: "solo cambio de nota" },
      { db: database, scope: SYSTEM_SCOPE, role: "administrador", cancelRemindersForOrder, scheduleReminder },
    );

    expect(cancelRemindersForOrder).not.toHaveBeenCalled();
    expect(scheduleReminder).not.toHaveBeenCalled();
  });

  /**
   * A `service_due` reminder's `scheduledFor` is frozen at completion time from
   * the category's interval, but `job.ts` reads `categoria` at FIRE time to pick
   * the copy. Re-categorising a finished order (a closed-order-lock correction)
   * desynchronised the two:
   *
   * - The STALE INTERVAL is pre-existing. Before revisado got its 365-day
   *   interval, patching `mant_preventivo` -> `revisado` left a 90-day reminder
   *   booked for a category that was supposed to get none at all.
   * - The LYING MESSAGE is new, and arrived with the category-aware copy: the
   *   same 90-day booking now reads "Pasó un año desde tu último revisado".
   *
   * One replan closes both. Mirrors the `appointmentChanged` branch exactly —
   * same `cancelRemindersForOrder` / `planAndScheduleReminders` seams. The order
   * is `done`, so every case here runs as a correction (a grant is passed).
   */
  function makeCategoriaFixture(ordenOverrides: Record<string, unknown>) {
    const { database, log } = lockedDb({
      ...OPEN_ROW,
      status: "done",
      completedAt: new Date("2026-07-01T00:00:00.000Z"),
      ...ordenOverrides,
    });
    return {
      database,
      log,
      cancelRemindersForOrder: vi.fn().mockResolvedValue(undefined),
      scheduleReminder: vi.fn().mockResolvedValue("job-cat"),
      getClienteById: vi.fn().mockResolvedValue({ cliente: clienteRow, orders: [], vehicles: [] }),
    };
  }

  const CATEGORIA_NOW = new Date("2026-07-26T12:00:00.000Z");
  const asCorrection = (f: ReturnType<typeof makeCategoriaFixture>) => ({
    db: f.database,
    scope: SYSTEM_SCOPE, role: "administrador" as const,
    correction: GRANT,
    now: () => CATEGORIA_NOW,
    getClienteById: f.getClienteById,
    cancelRemindersForOrder: f.cancelRemindersForOrder,
    scheduleReminder: f.scheduleReminder,
  });

  it("updateOrder replans the service_due at the NEW category's interval when categoria changes on a completed order", async () => {
    const f = makeCategoriaFixture({});

    await updateOrder("o1", { categoria: "revisado" }, asCorrection(f));

    expect(f.cancelRemindersForOrder).toHaveBeenCalledWith("o1", "service_due", expect.anything());
    // The interval, not just "something was scheduled": at 90 days this reads
    // 2026-09-29 and the whole fix is a no-op.
    expect(f.scheduleReminder).toHaveBeenCalledTimes(2);
    for (const [row] of f.scheduleReminder.mock.calls) {
      expect(row.type).toBe("service_due");
      expect(row.scheduledFor).toEqual(new Date("2027-07-01T00:00:00.000Z"));
    }
  });

  it("updateOrder replans reminders only AFTER the transaction commits", async () => {
    const f = makeCategoriaFixture({});
    const committedAtCancel: boolean[] = [];
    f.cancelRemindersForOrder.mockImplementation(async () => {
      committedAtCancel.push(f.log.committed);
    });

    await updateOrder("o1", { categoria: "revisado" }, asCorrection(f));

    expect(committedAtCancel).toEqual([true]);
  });

  it("updateOrder cancels and schedules NOTHING when categoria changes to one with no service_due interval", async () => {
    const f = makeCategoriaFixture({});

    await updateOrder("o1", { categoria: "instalacion" }, asCorrection(f));

    expect(f.cancelRemindersForOrder).toHaveBeenCalledWith("o1", "service_due", expect.anything());
    expect(f.scheduleReminder).not.toHaveBeenCalled();
  });

  it("updateOrder does NOT touch reminders when categoria changes on an order that was never completed", async () => {
    const f = makeCategoriaFixture({ status: "in_progress", completedAt: null });

    await updateOrder("o1", { categoria: "revisado" }, asCorrection(f));

    expect(f.cancelRemindersForOrder).not.toHaveBeenCalled();
    expect(f.scheduleReminder).not.toHaveBeenCalled();
    // No branch fired, so the cliente was never looked up.
    expect(f.getClienteById).not.toHaveBeenCalled();
  });

  it("updateOrder does NOT touch reminders when the patch re-sends the categoria it already has", async () => {
    const f = makeCategoriaFixture({});

    await updateOrder("o1", { categoria: "mant_preventivo" }, asCorrection(f));

    expect(f.cancelRemindersForOrder).not.toHaveBeenCalled();
    expect(f.scheduleReminder).not.toHaveBeenCalled();
    expect(f.getClienteById).not.toHaveBeenCalled();
  });

  it("updateOrder fires both branches independently, on one cliente lookup, when a patch carries appointmentAt AND categoria", async () => {
    const f = makeCategoriaFixture({ appointmentAt: new Date("2026-08-01T10:00:00.000Z") });

    await updateOrder(
      "o1",
      { appointmentAt: new Date("2026-08-05T10:00:00.000Z"), categoria: "revisado" },
      asCorrection(f),
    );

    expect(f.cancelRemindersForOrder).toHaveBeenCalledWith("o1", "appointment", expect.anything());
    expect(f.cancelRemindersForOrder).toHaveBeenCalledWith("o1", "service_due", expect.anything());
    const types = f.scheduleReminder.mock.calls.map(([row]) => row.type);
    expect(types.filter((t: string) => t === "appointment")).toHaveLength(2);
    expect(types.filter((t: string) => t === "service_due")).toHaveLength(2);
    // Two branches, one lookup — the constraint that made this branch share the
    // fetch instead of duplicating the `appointmentChanged` block.
    expect(f.getClienteById).toHaveBeenCalledTimes(1);
  });
});

/**
 * R20/D5 — "server-side, not only hidden in the UI". `createOrder` already
 * refuses a soft-deleted VEHICLE; the customer had no equivalent guard, so the
 * picker's exclusion was the only thing standing between a retired customer
 * and a new order.
 */
describe("createOrder — a deactivated cliente (R20)", () => {
  const VEHICLE = { id: "v1", clienteId: "c1", plate: "ABC123", deactivatedAt: null };

  function detail(deactivatedAt: Date | null) {
    return {
      cliente: { id: "c1", name: "Retirado", phone: "50761111111", deactivatedAt } as never,
      orders: [],
      vehicles: [VEHICLE as never],
    };
  }

  const input = { clienteId: "c1", vehiculoId: "v1", categoria: "mant_preventivo", description: "x" };

  it("refuses to open an order against a deactivated customer", async () => {
    const db = { transaction: vi.fn() };
    await expect(
      createOrder(input as never, {
        getClienteById: async () => detail(new Date("2026-09-01")),
        db: db as never,
      }),
    ).rejects.toBeInstanceOf(ClienteDeactivatedError);
    // Nothing written: the refusal lands before the transaction opens.
    expect(db.transaction).not.toHaveBeenCalled();
  });

  // The stale-page, two-staff scenario: A opens "Nueva orden" and picks Juan,
  // B deactivates Juan, A submits. Without the guard the order is created for
  // someone whose reminders then log `skipped` and who only appears behind
  // `?includeInactive=1`.
  it("still opens an order for an ACTIVE customer", async () => {
    const db = {
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          insert: () => ({ values: () => ({ returning: async () => [{ id: "o1" }] }) }),
        }),
      ),
    };
    const orden = await createOrder(input as never, {
      getClienteById: async () => detail(null),
      db: db as never,
    });
    expect(orden).toBeTruthy();
  });
});

describe("createOrder — assigned technicians (R20)", () => {
  type Row = { id: string; deactivatedAt: Date | null };
  const ACTOR = "admin-1";

  /** `makeFakeTx` plus the roster lookup: `select().from().where()` resolves to `roster`. */
  function setup(roster: Row[]) {
    const fake = makeFakeTx();
    const selects: unknown[] = [];
    const tx = {
      ...fake.tx,
      select: () => ({
        from: () => ({
          where: (condition: unknown) => {
            selects.push(condition);
            return Promise.resolve(roster);
          },
        }),
      }),
    };
    const database = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) };
    const deps = {
      getClienteById: async () => ({ cliente: { id: "c1" }, orders: [], vehicles: [fakeVehiculo()] }) as never,
      db: database as unknown as typeof import("@/shared/db/client").db,
    };
    return { ...fake, selects, deps };
  }
  const base = { clienteId: "c1", vehiculoId: "v1", categoria: "revisado" as const };

  it("writes one assignment per technician in the same transaction, after the order, stamped with the creator", async () => {
    const { deps, insertedOrders, insertedItems } = setup([
      { id: "t1", deactivatedAt: null },
      { id: "t2", deactivatedAt: null },
    ]);

    const orden = await createOrder({ ...base, createdBy: ACTOR, tecnicoIds: ["t1", "t2"] }, deps);

    expect(orden.status).toBe("open");
    expect(insertedOrders).toHaveLength(1);
    expect(insertedItems).toEqual([
      [
        { ordenId: "o1", tecnicoId: "t1", assignedBy: ACTOR },
        { ordenId: "o1", tecnicoId: "t2", assignedBy: ACTOR },
      ],
    ]);
  });

  it("assigns a technician named twice once", async () => {
    const { deps, insertedItems } = setup([{ id: "t1", deactivatedAt: null }]);
    await createOrder({ ...base, createdBy: ACTOR, tecnicoIds: ["t1", "t1"] }, deps);
    expect(insertedItems).toEqual([[{ ordenId: "o1", tecnicoId: "t1", assignedBy: ACTOR }]]);
  });

  it("creates an open order with no assignment and never reads the roster when no technician is named", async () => {
    const { deps, insertedOrders, insertedItems, selects } = setup([]);
    const orden = await createOrder({ ...base, createdBy: ACTOR, tecnicoIds: [] }, deps);
    const omitted = await createOrder({ ...base, createdBy: ACTOR }, deps);

    expect([orden.status, omitted.status]).toEqual(["open", "open"]);
    expect(insertedOrders).toHaveLength(2);
    expect(insertedItems).toEqual([]);
    expect(selects).toEqual([]);
  });

  it("refuses to assign without an actor to stamp: assigned_by is NOT NULL, so this is a bug in the caller, not a 500 from the FK", async () => {
    const { deps, insertedOrders } = setup([{ id: "t1", deactivatedAt: null }]);
    await expect(createOrder({ ...base, tecnicoIds: ["t1"] }, deps)).rejects.toThrow("needs createdBy");
    expect(insertedOrders).toEqual([]);
  });

  it("refuses a deactivated technician with a Spanish message and creates nothing", async () => {
    const { deps, insertedOrders, insertedItems } = setup([{ id: "t1", deactivatedAt: new Date("2026-09-01") }]);

    const refused = createOrder({ ...base, createdBy: ACTOR, tecnicoIds: ["t1"] }, deps);

    await expect(refused).rejects.toBeInstanceOf(InvalidTecnicoError);
    await expect(refused).rejects.toMatchObject({ errors: { tecnicoIds: "Elegí técnicos activos" } });
    expect(insertedOrders).toEqual([]);
    expect(insertedItems).toEqual([]);
  });

  it("refuses an unknown technician the same way: one id the roster does not return fails the lot", async () => {
    const { deps, insertedOrders } = setup([{ id: "t1", deactivatedAt: null }]);
    await expect(createOrder({ ...base, createdBy: ACTOR, tecnicoIds: ["t1", "ghost"] }, deps)).rejects.toBeInstanceOf(
      InvalidTecnicoError,
    );
    expect(insertedOrders).toEqual([]);
  });
});

describe("transitionOrder — who may transition, and the lock's scope (R21)", () => {
  const at = (status: "open" | "in_progress" | "ready_for_review") => ({ ...OPEN_ROW, status });

  it("lets a caller without service-orders.assign start work: open -> in_progress", async () => {
    const { database, log } = lockedDb(at("open"));
    await transitionOrder("o1", "in_progress", { db: database, scope: SYSTEM_SCOPE, canAssign: false });
    expect(log.sets).toEqual([{ status: "in_progress" }]);
  });

  it.each([
    ["in_progress", "done"],
    ["in_progress", "cancelled"],
    ["ready_for_review", "in_progress"],
  ] as const)("refuses %s -> %s for a caller without service-orders.assign, writing nothing", async (from, to) => {
    const { database, log } = lockedDb(at(from));
    await expect(
      transitionOrder("o1", to, { db: database, scope: SYSTEM_SCOPE, canAssign: false }),
    ).rejects.toBeInstanceOf(TransitionForbiddenError);
    expect(log.sets).toEqual([]);
  });

  it("clears every part-ready mark when staff send a ready_for_review order back, in the same transaction", async () => {
    const { database, log } = lockedDb(at("ready_for_review"));
    await transitionOrder("o1", "in_progress", { db: database, scope: SYSTEM_SCOPE, canAssign: true });
    expect(log.sets).toEqual([{ status: "in_progress" }, { parteListaAt: null }]);
    expect(log.committed).toBe(true);
  });

  it.each([
    ["open", "in_progress"],
    ["in_progress", "cancelled"],
    ["ready_for_review", "done"],
    ["ready_for_review", "cancelled"],
  ] as const)("leaves the marks alone on %s -> %s", async (from, to) => {
    const { database, log } = lockedDb(at(from));
    await transitionOrder("o1", to, {
      db: database,
      scope: SYSTEM_SCOPE,
      canAssign: true,
      getClienteById: async () => null,
      cancelRemindersForOrder: async () => {},
    });
    expect(log.sets.some((patch) => "parteListaAt" in patch)).toBe(false);
  });

  it.each([
    ["in_progress", "done"],
    ["ready_for_review", "done"],
    ["ready_for_review", "cancelled"],
    ["ready_for_review", "in_progress"],
  ] as const)("lets service-orders.assign close or return %s -> %s", async (from, to) => {
    const { database, log } = lockedDb(at(from));
    await transitionOrder("o1", to, {
      db: database,
      scope: SYSTEM_SCOPE,
      canAssign: true,
      getClienteById: async () => null,
      cancelRemindersForOrder: async () => {},
    });
    expect(log.sets[0]).toMatchObject({ status: to });
  });

  it("answers an illegal edge as the state machine's error even for a caller who could not make a legal one", async () => {
    const { database } = lockedDb(at("open"));
    await expect(
      transitionOrder("o1", "done", { db: database, scope: SYSTEM_SCOPE, canAssign: false }),
    ).rejects.toBeInstanceOf(OrderTransitionError);
  });

  it("locks through the caller's scope: a técnico's condition reaches the SELECT ... FOR UPDATE", async () => {
    const { database, log } = lockedDb(at("open"));
    await transitionOrder("o1", "in_progress", {
      db: database,
      scope: orderScope({ id: "tec-user", role: "tecnico" }),
      canAssign: false,
    });
    const { sql, params } = new PgDialect().sqlToQuery(log.wheres[0] as never);
    expect(sql).toContain('"orden_tecnico"."orden_id" = "orden_servicio"."id"');
    expect(params).toContain("tec-user");
  });
});

describe("updateOrder — the lock's scope", () => {
  it("locks through the caller's scope: a técnico's condition reaches the SELECT ... FOR UPDATE", async () => {
    const { database, log } = lockedDb({ ...OPEN_ROW, status: "in_progress" });
    await updateOrder(
      "o1",
      { hallazgos: "x" },
      { db: database, role: "tecnico", scope: orderScope({ id: "tec-user", role: "tecnico" }) },
    );
    const { sql, params } = new PgDialect().sqlToQuery(log.wheres[0] as never);
    expect(sql).toContain('"orden_tecnico"."orden_id" = "orden_servicio"."id"');
    expect(params).toContain("tec-user");
  });
});

/**
 * customer-portal WU5b — every committed change to an order re-syncs its
 * customer to the portal. The enqueue must come AFTER the commit (a rolled-back
 * edit must enqueue nothing, a committed one must not wait on the queue) and
 * must reach the customer the ORDER belongs to.
 */
describe("portal sync triggers", () => {
  /** Records `committed` as of each enqueue, so "after the commit" is observable. */
  function observed(log: { committed: boolean }) {
    const calls: { clienteId: string; committed: boolean }[] = [];
    const enqueuePortalSync = vi.fn(async (clienteId: string) => void calls.push({ clienteId, committed: log.committed }));
    return { calls, enqueuePortalSync };
  }

  it("createOrder enqueues the order's customer once, after the commit", async () => {
    const { tx } = makeFakeTx();
    const log = { committed: false };
    const database = {
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const result = await fn(tx);
        log.committed = true;
        return result;
      },
    };
    const { calls, enqueuePortalSync } = observed(log);

    await createOrder(
      { clienteId: "c1", vehiculoId: "v1", categoria: "revisado" },
      {
        getClienteById: async () => ({ cliente: { id: "c1" }, orders: [], vehicles: [fakeVehiculo()] }) as never,
        db: database as unknown as typeof import("@/shared/db/client").db,
        enqueuePortalSync,
      },
    );

    expect(calls).toEqual([{ clienteId: "c1", committed: true }]);
  });

  it("updateOrder enqueues the order's customer once, after the commit, corrections included", async () => {
    const plain = lockedDb(OPEN_ROW);
    const a = observed(plain.log);
    await updateOrder("o1", { hallazgos: "Fuga" }, { db: plain.database, scope: SYSTEM_SCOPE, role: "administrador", enqueuePortalSync: a.enqueuePortalSync });
    expect(a.calls).toEqual([{ clienteId: "c1", committed: true }]);

    const closed = lockedDb({ ...OPEN_ROW, status: "done" });
    const b = observed(closed.log);
    await updateOrder(
      "o1",
      { hallazgos: "Fuga" },
      { db: closed.database, scope: SYSTEM_SCOPE, role: "administrador", correction: GRANT, enqueuePortalSync: b.enqueuePortalSync },
    );
    expect(b.calls).toEqual([{ clienteId: "c1", committed: true }]);
  });

  it("transitionOrder enqueues the order's customer once, after the commit", async () => {
    const { database, log } = lockedDb({ ...OPEN_ROW, status: "open" });
    const { calls, enqueuePortalSync } = observed(log);
    await transitionOrder("o1", "in_progress", { db: database, scope: SYSTEM_SCOPE, canAssign: true, enqueuePortalSync });
    expect(calls).toEqual([{ clienteId: "c1", committed: true }]);
  });

  it("enqueues before the reminder wiring, so a reminder failure cannot lose the sync", async () => {
    const { database, log } = lockedDb({ ...OPEN_ROW, status: "in_progress" });
    const { calls, enqueuePortalSync } = observed(log);
    await expect(
      transitionOrder("o1", "done", {
        db: database,
        scope: SYSTEM_SCOPE,
        canAssign: true,
        enqueuePortalSync,
        getClienteById: async () => {
          throw new Error("reminder wiring blew up");
        },
      }),
    ).rejects.toThrow("reminder wiring blew up");
    expect(calls).toEqual([{ clienteId: "c1", committed: true }]);
  });

  it("enqueues nothing when the transaction rolls back (refused edit, illegal transition, missing order)", async () => {
    const enqueuePortalSync = vi.fn(async () => {});
    const closed = lockedDb({ ...OPEN_ROW, status: "done" });
    await expect(
      updateOrder("o1", { hallazgos: "x" }, { db: closed.database, scope: SYSTEM_SCOPE, role: "administrador", enqueuePortalSync }),
    ).rejects.toBeInstanceOf(OrderClosedError);
    await expect(
      transitionOrder("o1", "in_progress", { db: closed.database, scope: SYSTEM_SCOPE, canAssign: true, enqueuePortalSync }),
    ).rejects.toBeInstanceOf(OrderTransitionError);
    const missing = lockedDb(null);
    await expect(
      transitionOrder("nope", "in_progress", { db: missing.database, scope: SYSTEM_SCOPE, canAssign: true, enqueuePortalSync }),
    ).rejects.toBeInstanceOf(OrdenServicioNotFoundError);
    expect(enqueuePortalSync).not.toHaveBeenCalled();
  });
});
