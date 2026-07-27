import { describe, expect, it, vi } from "vitest";

import type { OrdenServicio } from "@/shared/db/schema";
import { OrderTransitionError } from "./transitions";
import {
  createOrder,
  normalizeOrderItems,
  OrdenServicioNotFoundError,
  transitionOrder,
  UnknownClienteError,
  updateOrder,
} from "./service";

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
        { clienteId: "missing" },
        { getClienteById: async () => null, db: database as unknown as typeof import("@/shared/db/client").db },
      ),
    ).rejects.toBeInstanceOf(UnknownClienteError);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("creates an order with no parts attached (empty items list)", async () => {
    const { tx, insertedItems } = makeFakeTx();
    const database = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) };

    const result = await createOrder(
      { clienteId: "c1" },
      {
        getClienteById: async () => ({ cliente: { id: "c1" }, orders: [] }) as never,
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
        items: [
          { productoId: "p1", productName: "Filtro de aceite", quantity: 2, unitPrice: 100 },
          { productoId: "p1", productName: "Filtro de aceite", quantity: 1, unitPrice: 100 },
        ],
      },
      {
        getClienteById: async () => ({ cliente: { id: "c1" }, orders: [] }) as never,
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
      { clienteId: "c1", items: [{ productoId: "p1", productName: "Filtro de aceite", quantity: 1 }] },
      {
        getClienteById: async () => ({ cliente: { id: "c1" }, orders: [] }) as never,
        db: database as unknown as typeof import("@/shared/db/client").db,
      },
    );

    expect(updateSpy).not.toHaveBeenCalled();
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
      { clienteId: "c1", appointmentAt: new Date("2026-08-01T10:00:00.000Z") },
      {
        getClienteById: async () => ({ cliente: clienteRow, orders: [] }),
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
      { clienteId: "c1" },
      {
        getClienteById: async () => ({ cliente: clienteRow, orders: [] }),
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
      getClienteById: async () => ({ cliente: clienteRow, orders: [] }),
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
        getClienteById: async () => ({ cliente: clienteRow, orders: [] }),
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
