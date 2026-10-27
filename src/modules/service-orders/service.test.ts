import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { ClienteDeactivatedError } from "@/modules/customers/service";

import { ordenCategoriaEnum, ordenEstadoHistorial, ordenServicioCorreccion, type Vehiculo } from "@/shared/db/schema";
import { OrderClosedError, OrderEditForbiddenError } from "./order-lock";
import { orderScope, SYSTEM_SCOPE } from "./scope";
import { InvalidTecnicoError } from "./assignments";
import { OrderTransitionError, TransitionForbiddenError } from "./transitions";
import {
  AppointmentRequiredError,
  createOrder,
  EsperaMotivoError,
  InvalidCategoriaError,
  InvalidInitialStatusError,
  OrderIncompleteError,
  InvalidVehiculoError,
  OrdenServicioNotFoundError,
  StaleOrderStatusError,
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
  const history: Record<string, unknown>[] = [];
  const updateSpy = vi.fn();

  const tx = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        if (table === ordenEstadoHistorial) {
          history.push(values as Record<string, unknown>);
          return Promise.resolve(undefined);
        }
        if (Array.isArray(values)) {
          insertedItems.push(values as unknown[]);
          return Promise.resolve(undefined);
        }
        insertedOrders.push(values);
        return {
          returning: async () => [{ id: "o1", ...(values as Record<string, unknown>) }],
        };
      },
    }),
    update: (...args: unknown[]) => {
      updateSpy(...args);
      return {
        set: (patch: Record<string, unknown>) => ({
          where: () => ({ returning: async () => [{ ...(insertedOrders[0] as object), id: "o1", ...patch }] }),
        }),
      };
    },
  };

  return { tx, insertedOrders, insertedItems, history, updateSpy };
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
  vehiculoId: "v1",
  status: "open",
  esperaMotivo: null,
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
/** `reads` is what any unlocked select resolves with: the assignments on a receive, the vehicle on a booked edit. */
function lockedDb(order: Record<string, unknown> | null, reads: unknown[] = []) {
  const log = {
    history: [] as Record<string, unknown>[],
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
            // The assignments read (receive): `select().from(ordenTecnico).where()` is awaited with no `.for()`.
            then: (resolve: (v: unknown) => unknown) => resolve(reads),
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
    insert: (table: unknown) => ({
      values: async (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        (table === ordenEstadoHistorial ? log.history : log.audit).push(...[rows].flat());
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

  // Agenda Reprogramar: a screen that loaded the order as booked must not reschedule one received since.
  it("Stale reprogram is refused: expectedStatus differing from the LOCKED status throws StaleOrderStatusError and writes nothing", async () => {
    const { database, log } = lockedDb({ ...OPEN_ROW, status: "open" });
    const cancelRemindersForOrder = vi.fn().mockResolvedValue(undefined);
    const enqueuePortalSync = vi.fn();

    await expect(
      updateOrder(
        "o1",
        { appointmentAt: new Date("2026-10-30T20:30:00Z") },
        { db: database, scope: SYSTEM_SCOPE, role: "administrador", expectedStatus: "booked", cancelRemindersForOrder, enqueuePortalSync },
      ),
    ).rejects.toBeInstanceOf(StaleOrderStatusError);

    expect(log.locks).toEqual(["update"]);
    expect(log.sets).toEqual([]);
    expect(cancelRemindersForOrder).not.toHaveBeenCalled();
    expect(enqueuePortalSync).not.toHaveBeenCalled();
  });

  it("a field edit proceeds when expectedStatus matches the LOCKED status, and without expectedStatus it is unchanged", async () => {
    const withGuard = lockedDb({ ...OPEN_ROW, status: "open" });
    await updateOrder("o1", { description: "a" }, { db: withGuard.database, scope: SYSTEM_SCOPE, role: "administrador", expectedStatus: "open" });
    expect(withGuard.log.sets).toEqual([{ description: "a" }]);

    const without = lockedDb({ ...OPEN_ROW, status: "open" });
    await updateOrder("o1", { description: "b" }, { db: without.database, scope: SYSTEM_SCOPE, role: "administrador" });
    expect(without.log.sets).toEqual([{ description: "b" }]);
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

  describe("a booked order (R20, Vehicle and Category Set While Booked)", () => {
    const BOOKED = { ...OPEN_ROW, status: "booked", vehiculoId: null, categoria: null, appointmentAt: new Date("2026-11-02T15:00:00Z") };
    const admin = { scope: SYSTEM_SCOPE, role: "administrador" as const };

    it("completes the vehicle and category while the status stays booked", async () => {
      const { database, log } = lockedDb(BOOKED, [{ id: "v2" }]);

      const orden = await updateOrder("o1", { vehiculoId: "v2", categoria: "revisado" }, { ...admin, db: database });

      expect(log.sets).toEqual([{ vehiculoId: "v2", categoria: "revisado" }]);
      expect(orden).toMatchObject({ status: "booked", vehiculoId: "v2", categoria: "revisado" });
    });

    it("refuses a vehicle that is not an active one of this customer, in Spanish, writing nothing", async () => {
      const { database, log } = lockedDb(BOOKED, []);

      const refused = updateOrder("o1", { vehiculoId: "v-foreign" }, { ...admin, db: database });

      await expect(refused).rejects.toBeInstanceOf(InvalidVehiculoError);
      await expect(refused).rejects.toMatchObject({ errors: { vehiculoId: "Seleccioná un vehículo válido de este cliente" } });
      expect(log.sets).toEqual([]);
    });

    it("scopes the vehicle lookup to the order's customer and to active vehicles", async () => {
      const { database, log } = lockedDb(BOOKED, [{ id: "v2" }]);

      await updateOrder("o1", { vehiculoId: "v2" }, { ...admin, db: database });

      const lookup = new PgDialect().sqlToQuery(log.wheres[1] as never);
      expect(lookup.sql).toContain('"vehiculo"."cliente_id" = $');
      expect(lookup.sql).toContain('"vehiculo"."deactivated_at" is null');
      expect(lookup.params).toEqual(expect.arrayContaining(["v2", "c1"]));
    });

    it("refuses a técnico setting the vehicle: the edit gate refuses booked for them", async () => {
      const { database, log } = lockedDb(BOOKED, [{ id: "v2" }]);

      await expect(updateOrder("o1", { vehiculoId: "v2" }, { scope: SYSTEM_SCOPE, role: "tecnico", db: database })).rejects.toBeInstanceOf(
        OrderEditForbiddenError,
      );
      expect(log.sets).toEqual([]);
    });

    it("refuses clearing the date, and still accepts moving it", async () => {
      const cleared = lockedDb(BOOKED);
      const refused = updateOrder("o1", { appointmentAt: null }, { ...admin, db: cleared.database });
      await expect(refused).rejects.toBeInstanceOf(AppointmentRequiredError);
      await expect(refused).rejects.toMatchObject({ errors: { appointmentAt: "Una orden agendada necesita su fecha y hora" } });
      expect(cleared.log.sets).toEqual([]);

      const moved = lockedDb(BOOKED);
      const later = new Date("2026-11-09T15:00:00Z");
      await updateOrder("o1", { appointmentAt: later }, { ...admin, db: moved.database, getClienteById: async () => null, cancelRemindersForOrder: async () => {} });
      expect(moved.log.sets).toEqual([{ appointmentAt: later }]);
    });
  });

  // Vehicle frozen after booked: from `open` on, the vehicle is what the car's history hangs on.
  describe.each(["open", "diagnosing", "in_progress", "on_hold", "ready_for_review"])("an order that is %s", (status) => {
    it("refuses a vehiculoId in the patch and keeps the stored vehicle", async () => {
      const { database, log } = lockedDb({ ...OPEN_ROW, status }, [{ id: "v2" }]);

      await expect(updateOrder("o1", { vehiculoId: "v2" }, { db: database, scope: SYSTEM_SCOPE, role: "administrador" })).rejects.toBeInstanceOf(
        InvalidVehiculoError,
      );
      expect(log.sets).toEqual([]);
    });
  });

  it("lets a cleared date through on an order that is not booked", async () => {
    const { database, log } = lockedDb({ ...OPEN_ROW, appointmentAt: new Date("2026-11-02T15:00:00Z") });

    await updateOrder("o1", { appointmentAt: null }, { db: database, scope: SYSTEM_SCOPE, role: "administrador", getClienteById: async () => null, cancelRemindersForOrder: async () => {} });

    expect(log.sets).toEqual([{ appointmentAt: null }]);
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
  const rowAt = (status: "diagnosing" | "in_progress") => ({ ...OPEN_ROW, status });
  const staff = { scope: SYSTEM_SCOPE, canAssign: true, actorId: "jefe-1" };

  it("throws OrdenServicioNotFoundError for a missing order", async () => {
    const { database } = lockedDb(null);
    await expect(transitionOrder("missing", "in_progress", { ...staff, db: database })).rejects.toBeInstanceOf(
      OrdenServicioNotFoundError,
    );
  });

  it("takes the row lock (FOR UPDATE) before writing, and writes the status and its history row in one transaction", async () => {
    const { database, log } = lockedDb(rowAt("diagnosing"));

    await transitionOrder("o1", "in_progress", { ...staff, db: database });

    expect(log.locks).toEqual(["update"]);
    expect(log.sets).toEqual([{ status: "in_progress", esperaMotivo: null, updatedAt: expect.any(Date) }]);
    expect(log.history).toEqual([
      { ordenId: "o1", fromStatus: "diagnosing", toStatus: "in_progress", esperaMotivo: null, changedBy: "jefe-1" },
    ]);
  });

  it.each([
    ["open", "in_progress"],
    ["open", "done"],
    ["diagnosing", "done"],
  ] as const)("rejects the invalid transition %s -> %s without writing", async (from, to) => {
    const { database, log } = lockedDb({ ...OPEN_ROW, status: from });

    await expect(transitionOrder("o1", to, { ...staff, db: database })).rejects.toBeInstanceOf(OrderTransitionError);
    expect(log.sets).toEqual([]);
    expect(log.history).toEqual([]);
  });

  // Automatic targets are written by their own paths (assignment, readiness), never by the route.
  it.each([
    ["open", "diagnosing"],
    ["in_progress", "ready_for_review"],
  ] as const)("refuses the automatic target %s -> %s with OrderTransitionError and no write", async (from, to) => {
    const { database, log } = lockedDb({ ...OPEN_ROW, status: from });

    await expect(transitionOrder("o1", to, { ...staff, db: database })).rejects.toBeInstanceOf(OrderTransitionError);
    expect(log.sets).toEqual([]);
  });

  it.each(["done", "cancelled"] as const)(
    "refuses a transition out of a locked %s order with OrderTransitionError and no write",
    async (status) => {
      const { database, log } = lockedDb({ ...OPEN_ROW, status });

      await expect(transitionOrder("o1", "in_progress", { ...staff, db: database })).rejects.toBeInstanceOf(OrderTransitionError);
      expect(log.locks).toEqual(["update"]);
      expect(log.sets).toEqual([]);
    },
  );

  it("in_progress -> done sets completedAt", async () => {
    const { database } = lockedDb(rowAt("in_progress"));
    const fixedNow = new Date("2026-07-26T12:00:00Z");

    const result = await transitionOrder("o1", "done", { ...staff,
      db: database,
      now: () => fixedNow,
      // No cliente found: the service_due wiring no-ops; this test only asserts completedAt.
      getClienteById: async () => null,
    });

    expect(result.status).toBe("done");
    expect(result.completedAt).toEqual(fixedNow);
  });

  it("diagnosing -> in_progress leaves completedAt untouched", async () => {
    const { database, log } = lockedDb(rowAt("diagnosing"));
    await transitionOrder("o1", "in_progress", { ...staff, db: database });
    expect(log.sets[0]).not.toHaveProperty("completedAt");
  });

  it("calls the onTransitioned seam after persisting (Phase 4 hook point)", async () => {
    const { database } = lockedDb(rowAt("in_progress"));
    const onTransitioned = vi.fn();
    const cancelRemindersForOrder = vi.fn().mockResolvedValue(undefined);

    await transitionOrder("o1", "cancelled", { ...staff, db: database, onTransitioned, cancelRemindersForOrder });

    expect(onTransitioned).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }), "in_progress", "cancelled");
  });

  // Agenda "No se presentó": a screen that loaded the order as booked must not cancel one received since.
  it("Stale no-show is refused: expectedStatus differing from the LOCKED status throws StaleOrderStatusError and writes nothing", async () => {
    const { database, log } = lockedDb({ ...OPEN_ROW, status: "open" });
    const cancelRemindersForOrder = vi.fn().mockResolvedValue(undefined);
    const onTransitioned = vi.fn();

    await expect(
      transitionOrder("o1", "cancelled", { ...staff, db: database, expectedStatus: "booked", cancelRemindersForOrder, onTransitioned }),
    ).rejects.toBeInstanceOf(StaleOrderStatusError);

    expect(log.locks).toEqual(["update"]);
    expect(log.sets).toEqual([]);
    expect(log.history).toEqual([]);
    expect(cancelRemindersForOrder).not.toHaveBeenCalled();
    expect(onTransitioned).not.toHaveBeenCalled();
  });

  it("proceeds when expectedStatus matches the locked status", async () => {
    const { database, log } = lockedDb({ ...OPEN_ROW, status: "booked" });

    await transitionOrder("o1", "cancelled", { ...staff, db: database, expectedStatus: "booked", cancelRemindersForOrder: async () => {} });

    expect(log.history).toEqual([expect.objectContaining({ fromStatus: "booked", toStatus: "cancelled" })]);
  });

  it("Transitions without expectedStatus are unchanged: no expectedStatus transitions from any status", async () => {
    const { database, log } = lockedDb({ ...OPEN_ROW, status: "open" });

    await transitionOrder("o1", "cancelled", { ...staff, db: database, cancelRemindersForOrder: async () => {} });

    expect(log.history).toEqual([expect.objectContaining({ fromStatus: "open", toStatus: "cancelled" })]);
  });

  it("runs the reminder side effects only AFTER the transaction commits", async () => {
    const { database, log } = lockedDb(rowAt("in_progress"));
    let committedWhenCancelled: boolean | undefined;
    const cancelRemindersForOrder = vi.fn(async () => {
      committedWhenCancelled = log.committed;
    });

    await transitionOrder("o1", "cancelled", { ...staff, db: database, cancelRemindersForOrder });

    expect(committedWhenCancelled).toBe(true);
  });
});

describe("transitionOrder — the on-hold reason (R21)", () => {
  const staff = { scope: SYSTEM_SCOPE, canAssign: true, actorId: "jefe-1" };

  it.each(["repuesto", "aprobacion_cliente"] as const)("stores the reason %s on a hold and copies it to the history row", async (motivo) => {
    const { database, log } = lockedDb({ ...OPEN_ROW, status: "in_progress" });

    await transitionOrder("o1", "on_hold", { ...staff, db: database, esperaMotivo: motivo });

    expect(log.sets).toEqual([{ status: "on_hold", esperaMotivo: motivo, updatedAt: expect.any(Date) }]);
    expect(log.history).toEqual([expect.objectContaining({ fromStatus: "in_progress", toStatus: "on_hold", esperaMotivo: motivo })]);
  });

  it.each([undefined, null, "otro", ""])("refuses a hold with the reason %j, in Spanish, writing nothing", async (motivo) => {
    const { database, log } = lockedDb({ ...OPEN_ROW, status: "in_progress" });

    const refused = transitionOrder("o1", "on_hold", { ...staff, db: database, esperaMotivo: motivo as never });

    await expect(refused).rejects.toBeInstanceOf(EsperaMotivoError);
    await expect(refused).rejects.toMatchObject({ message: expect.stringContaining("motivo") });
    expect(log.sets).toEqual([]);
  });

  // The reason is checked after the lock, so a hold on an order that does not exist (or that the caller cannot see) is a 404, not a 400 that leaks which orders exist.
  it("answers a hold on a missing order with not found, whatever reason it carries", async () => {
    const { database } = lockedDb(null);

    await expect(transitionOrder("nope", "on_hold", { ...staff, db: database })).rejects.toBeInstanceOf(OrdenServicioNotFoundError);
    await expect(transitionOrder("nope", "done", { ...staff, db: database, esperaMotivo: "repuesto" })).rejects.toBeInstanceOf(
      OrdenServicioNotFoundError,
    );
  });

  it("refuses a reason that rides another target, writing nothing", async () => {
    const { database, log } = lockedDb({ ...OPEN_ROW, status: "in_progress" });

    await expect(transitionOrder("o1", "done", { ...staff, db: database, esperaMotivo: "repuesto" })).rejects.toBeInstanceOf(
      EsperaMotivoError,
    );
    expect(log.sets).toEqual([]);
  });

  it("clears the reason when the order is resumed, and leaves every part-ready mark alone", async () => {
    const { database, log } = lockedDb({ ...OPEN_ROW, status: "on_hold", esperaMotivo: "repuesto" });

    await transitionOrder("o1", "in_progress", { ...staff, db: database });

    expect(log.sets).toEqual([{ status: "in_progress", esperaMotivo: null, updatedAt: expect.any(Date) }]);
    expect(log.history[0]).toMatchObject({ fromStatus: "on_hold", toStatus: "in_progress", esperaMotivo: null });
  });
});

describe("transitionOrder — receiving a booked order (R21)", () => {
  const staff = { scope: SYSTEM_SCOPE, canAssign: true, actorId: "jefe-1" };

  it("moves booked -> open and stops there when nobody is assigned", async () => {
    const { database, log } = lockedDb({ ...OPEN_ROW, status: "booked" });

    const orden = await transitionOrder("o1", "open", { ...staff, db: database });

    expect(orden.status).toBe("open");
    expect(log.history.map((h) => [h.fromStatus, h.toStatus])).toEqual([["booked", "open"]]);
  });

  it("continues to diagnosing, in the same transaction, when a technician is already assigned", async () => {
    const { database, log } = lockedDb({ ...OPEN_ROW, status: "booked" }, [{ tecnicoId: "t1" }]);

    const orden = await transitionOrder("o1", "open", { ...staff, db: database });

    expect(orden.status).toBe("diagnosing");
    expect(log.history.map((h) => [h.fromStatus, h.toStatus, h.changedBy])).toEqual([
      ["booked", "open", "jefe-1"],
      ["open", "diagnosing", "jefe-1"],
    ]);
  });

  it.each([{ vehiculoId: null }, { categoria: null }])(
    "refuses to receive an order with %j, in Spanish, leaving it booked (never a CHECK 500)",
    async (missing) => {
      const { database, log } = lockedDb({ ...OPEN_ROW, status: "booked", ...missing });

      const refused = transitionOrder("o1", "open", { ...staff, db: database });

      await expect(refused).rejects.toBeInstanceOf(OrderIncompleteError);
      await expect(refused).rejects.toMatchObject({ message: expect.stringContaining("vehículo") });
      expect(log.sets).toEqual([]);
    },
  );
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
   * `categoria` is spelled out because it is nullable (0034) and the gate reads
   * it: the fixture used to omit it and the cast hid that, which is the "a
   * mock more convenient than reality tests the mock" case AGENTS.md names.
   * Omitted, `order.categoria` is `undefined` and no reminder is scheduled —
   * for the wrong reason.
   */
  it("transitionOrder -> done schedules a service_due reminder", async () => {
    const { database } = lockedDb({ ...OPEN_ROW, clienteId: "c1", status: "in_progress", categoria: "mant_preventivo" });
    const scheduleReminder = vi.fn().mockResolvedValue("job-2");

    await transitionOrder("o1", "done", { scope: SYSTEM_SCOPE, canAssign: true, actorId: "u1",
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

    await transitionOrder("o1", "done", { scope: SYSTEM_SCOPE, canAssign: true, actorId: "u1",
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

    await transitionOrder("o1", "cancelled", { scope: SYSTEM_SCOPE, canAssign: true, actorId: "u1",
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

    expect(orden.status).toBe("diagnosing");
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

describe("createOrder — initial status and history (R20)", () => {
  const ACTOR = "admin-1";
  const base = { clienteId: "c1", vehiculoId: "v1", categoria: "revisado" as const, createdBy: ACTOR };
  const APPOINTMENT = new Date("2026-11-02T15:00:00Z");

  function setup() {
    const fake = makeFakeTx();
    const tx = {
      ...fake.tx,
      select: () => ({ from: () => ({ where: async () => [{ id: "t1", deactivatedAt: null }] }) }),
    };
    const database = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) };
    const deps = {
      getClienteById: async () => ({ cliente: { id: "c1" }, orders: [], vehicles: [fakeVehiculo()] }) as never,
      db: database as unknown as typeof import("@/shared/db/client").db,
    };
    return { ...fake, deps };
  }
  const trail = (history: Record<string, unknown>[]) => history.map((h) => [h.fromStatus, h.toStatus, h.changedBy]);

  it("defaults to open and writes the null -> open row", async () => {
    const { deps, insertedOrders, history } = setup();
    const orden = await createOrder(base, deps);

    expect(insertedOrders[0]).toMatchObject({ status: "open" });
    expect(orden.status).toBe("open");
    expect(trail(history)).toEqual([[null, "open", ACTOR]]);
  });

  it("creates a booked order with the null -> booked row", async () => {
    const { deps, history } = setup();
    const orden = await createOrder({ ...base, status: "booked", appointmentAt: APPOINTMENT }, deps);

    expect(orden.status).toBe("booked");
    expect(trail(history)).toEqual([[null, "booked", ACTOR]]);
  });

  describe("an Agendada order may lack its vehicle and category, but never its date", () => {
    const booked = { clienteId: "c1", createdBy: ACTOR, status: "booked" as const };

    it("persists null vehiculoId and categoria, with the null -> booked row", async () => {
      const { deps, insertedOrders, history } = setup();

      const orden = await createOrder({ ...booked, appointmentAt: APPOINTMENT }, deps);

      expect(insertedOrders[0]).toMatchObject({ status: "booked", vehiculoId: null, categoria: null, appointmentAt: APPOINTMENT });
      expect(orden.status).toBe("booked");
      expect(trail(history)).toEqual([[null, "booked", ACTOR]]);
    });

    it("refuses a missing date in Spanish and creates nothing", async () => {
      const { deps, insertedOrders, history } = setup();

      const refused = createOrder(booked, deps);

      await expect(refused).rejects.toBeInstanceOf(AppointmentRequiredError);
      await expect(refused).rejects.toMatchObject({ errors: { appointmentAt: "Indicá la fecha y hora de la cita" } });
      expect(insertedOrders).toEqual([]);
      expect(history).toEqual([]);
    });

    it("still checks a vehicle it is given: another customer's is refused", async () => {
      const { deps, insertedOrders } = setup();

      await expect(createOrder({ ...booked, appointmentAt: APPOINTMENT, vehiculoId: "v-of-someone-else" }, deps)).rejects.toBeInstanceOf(
        InvalidVehiculoError,
      );
      expect(insertedOrders).toEqual([]);
    });

    it("still checks a category it is given", async () => {
      const { deps, insertedOrders } = setup();

      await expect(createOrder({ ...booked, appointmentAt: APPOINTMENT, categoria: "bogus" as never }, deps)).rejects.toBeInstanceOf(
        InvalidCategoriaError,
      );
      expect(insertedOrders).toEqual([]);
    });

    it("keeps a vehicle and category it is given", async () => {
      const { deps, insertedOrders } = setup();

      await createOrder({ ...booked, appointmentAt: APPOINTMENT, vehiculoId: "v1", categoria: "revisado" }, deps);

      expect(insertedOrders[0]).toMatchObject({ vehiculoId: "v1", categoria: "revisado" });
    });
  });

  describe("a Recibida order still needs both", () => {
    it("refuses a missing vehiculoId", async () => {
      const { deps, insertedOrders } = setup();
      await expect(createOrder({ clienteId: "c1", categoria: "revisado", createdBy: ACTOR }, deps)).rejects.toBeInstanceOf(InvalidVehiculoError);
      expect(insertedOrders).toEqual([]);
    });

    it("refuses a missing categoria", async () => {
      const { deps, insertedOrders } = setup();
      await expect(createOrder({ clienteId: "c1", vehiculoId: "v1", createdBy: ACTOR }, deps)).rejects.toBeInstanceOf(InvalidCategoriaError);
      expect(insertedOrders).toEqual([]);
    });
  });

  it("a walk-in with a technician lands in diagnosing with two rows, in order", async () => {
    const { deps, history } = setup();
    const orden = await createOrder({ ...base, tecnicoIds: ["t1"] }, deps);

    expect(orden.status).toBe("diagnosing");
    expect(trail(history)).toEqual([
      [null, "open", ACTOR],
      ["open", "diagnosing", ACTOR],
    ]);
  });

  it("an Agendada order with a technician stays booked, with no diagnosing row", async () => {
    const { deps, history, updateSpy } = setup();
    const orden = await createOrder({ ...base, status: "booked", appointmentAt: APPOINTMENT, tecnicoIds: ["t1"] }, deps);

    expect(orden.status).toBe("booked");
    expect(trail(history)).toEqual([[null, "booked", ACTOR]]);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it.each(["in_progress", "done", "diagnosing", "cancelled", "bogus"])("refuses the initial status %s and creates nothing", async (status) => {
    const { deps, insertedOrders, history } = setup();

    await expect(createOrder({ ...base, status: status as never }, deps)).rejects.toBeInstanceOf(InvalidInitialStatusError);

    expect(insertedOrders).toEqual([]);
    expect(history).toEqual([]);
  });
});

describe("transitionOrder — who may transition, and the lock's scope (R21)", () => {
  const at = (status: "diagnosing" | "in_progress" | "ready_for_review") => ({ ...OPEN_ROW, status });
  const deps = { scope: SYSTEM_SCOPE, actorId: "u1" };

  it.each([
    ["diagnosing", "in_progress"],
    ["in_progress", "done"],
    ["in_progress", "cancelled"],
    ["ready_for_review", "in_progress"],
  ] as const)("refuses %s -> %s for a caller without service-orders.assign, writing nothing", async (from, to) => {
    const { database, log } = lockedDb(at(from));
    await expect(
      transitionOrder("o1", to, { ...deps, db: database, canAssign: false }),
    ).rejects.toBeInstanceOf(TransitionForbiddenError);
    expect(log.sets).toEqual([]);
    expect(log.history).toEqual([]);
  });

  it("clears every part-ready mark when staff send a ready_for_review order back, in the same transaction", async () => {
    const { database, log } = lockedDb(at("ready_for_review"));
    await transitionOrder("o1", "in_progress", { ...deps, db: database, canAssign: true });
    expect(log.sets).toEqual([
      { status: "in_progress", esperaMotivo: null, updatedAt: expect.any(Date) },
      { parteListaAt: null },
    ]);
    expect(log.committed).toBe(true);
  });

  it.each([
    ["diagnosing", "in_progress"],
    ["in_progress", "cancelled"],
    ["ready_for_review", "done"],
    ["ready_for_review", "cancelled"],
  ] as const)("leaves the marks alone on %s -> %s", async (from, to) => {
    const { database, log } = lockedDb(at(from));
    await transitionOrder("o1", to, {
      ...deps,
      db: database,
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
      ...deps,
      db: database,
      canAssign: true,
      getClienteById: async () => null,
      cancelRemindersForOrder: async () => {},
    });
    expect(log.sets[0]).toMatchObject({ status: to });
  });

  it("answers an illegal edge as the state machine's error even for a caller who could not make a legal one", async () => {
    const { database } = lockedDb({ ...OPEN_ROW, status: "open" });
    await expect(
      transitionOrder("o1", "done", { ...deps, db: database, canAssign: false }),
    ).rejects.toBeInstanceOf(OrderTransitionError);
  });

  it("locks through the caller's scope: a técnico's condition reaches the SELECT ... FOR UPDATE", async () => {
    const { database, log } = lockedDb(at("diagnosing"));
    await expect(
      transitionOrder("o1", "in_progress", {
        ...deps,
        db: database,
        scope: orderScope({ id: "tec-user", role: "tecnico" }),
        canAssign: false,
      }),
    ).rejects.toBeInstanceOf(TransitionForbiddenError);
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
    const { database, log } = lockedDb({ ...OPEN_ROW, status: "diagnosing" });
    const { calls, enqueuePortalSync } = observed(log);
    await transitionOrder("o1", "in_progress", { db: database, scope: SYSTEM_SCOPE, canAssign: true, actorId: "u1", enqueuePortalSync });
    expect(calls).toEqual([{ clienteId: "c1", committed: true }]);
  });

  it("receiving a booked order enqueues once, after the commit, whether or not it continues to diagnosing", async () => {
    const plain = lockedDb({ ...OPEN_ROW, status: "booked" });
    const a = observed(plain.log);
    await transitionOrder("o1", "open", { db: plain.database, scope: SYSTEM_SCOPE, canAssign: true, actorId: "u1", enqueuePortalSync: a.enqueuePortalSync });
    expect(a.calls).toEqual([{ clienteId: "c1", committed: true }]);

    const continued = lockedDb({ ...OPEN_ROW, status: "booked" }, [{ tecnicoId: "t1" }]);
    const b = observed(continued.log);
    await transitionOrder("o1", "open", { db: continued.database, scope: SYSTEM_SCOPE, canAssign: true, actorId: "u1", enqueuePortalSync: b.enqueuePortalSync });
    expect(b.calls).toEqual([{ clienteId: "c1", committed: true }]);
  });

  it("enqueues before the reminder wiring, so a reminder failure cannot lose the sync", async () => {
    const { database, log } = lockedDb({ ...OPEN_ROW, status: "in_progress" });
    const { calls, enqueuePortalSync } = observed(log);
    await expect(
      transitionOrder("o1", "done", {
        db: database,
        scope: SYSTEM_SCOPE,
        canAssign: true, actorId: "u1",
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
      transitionOrder("o1", "in_progress", { db: closed.database, scope: SYSTEM_SCOPE, canAssign: true, actorId: "u1", enqueuePortalSync }),
    ).rejects.toBeInstanceOf(OrderTransitionError);
    const missing = lockedDb(null);
    await expect(
      transitionOrder("nope", "in_progress", { db: missing.database, scope: SYSTEM_SCOPE, canAssign: true, actorId: "u1", enqueuePortalSync }),
    ).rejects.toBeInstanceOf(OrdenServicioNotFoundError);
    expect(enqueuePortalSync).not.toHaveBeenCalled();
  });
});
