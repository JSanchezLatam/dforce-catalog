import { describe, expect, it, vi } from "vitest";

import { cliente, vehiculo, type Cliente, type Vehiculo } from "@/shared/db/schema";
import { ClienteNotFoundError, createCliente, DuplicatePhoneError, updateCliente, type DatabaseDep } from "./service";
import { ClienteValidationError } from "./validation";
import type { TxLike } from "./vehicles";

const validInput = { name: "Juan Pérez", phone: "+52 55 1234 5678" };

/**
 * A minimal fake of Drizzle's own query builder: every chain method returns
 * another instance of itself, and the whole thing is thenable (like Drizzle's
 * real `PgInsert`/`PgUpdate`), so both `await tx.insert(t).values(v)` (no
 * `.returning()`, as `vehicles.ts`'s `applyVehiculoPlan` does) and
 * `await tx.insert(t).values(v).returning()` (as `service.ts`'s own cliente
 * write does) resolve through the same fake.
 *
 * The settled promise is built LAZILY, at `then()`/`returning()` time. Built
 * eagerly in the factory, every intermediate link of an error chain
 * (`tx.insert(t)` before `.values(v)`) creates a rejected promise nobody ever
 * awaits — an unhandled rejection that is silent under this Vitest config and
 * a red suite under one that is stricter.
 */
function queryBuilder(resolvedValue: unknown, error?: Error) {
  const settle = () => (error ? Promise.reject(error) : Promise.resolve(resolvedValue));
  return {
    values: () => queryBuilder(resolvedValue, error),
    set: () => queryBuilder(resolvedValue, error),
    where: () => queryBuilder(resolvedValue, error),
    returning: () => settle(),
    then: (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      settle().then(onFulfilled, onRejected),
  };
}

/**
 * A fake `deps.database.transaction`, mirroring `account/service.test.ts`'s
 * `fakeTransactionalDatabase` — the real transaction seam needs a live
 * Postgres and is not exercised here (design.md's Testing Strategy).
 * `clienteRow` is what any `cliente` insert/update resolves to;
 * `vehiculoInsertError`/`vehiculoUpdateError` let a test simulate the
 * vehicle-side write failing. `transaction` here only calls its callback —
 * there is no rollback and no state to roll back, so no test in this file can
 * assert atomicity, only that the failure propagates.
 */
function fakeDatabase(
  clienteRow: Cliente,
  opts: { vehiculoInsertError?: Error; vehiculoUpdateError?: Error } = {},
) {
  const insert = vi.fn((table: unknown) =>
    table === vehiculo ? queryBuilder(undefined, opts.vehiculoInsertError) : queryBuilder([clienteRow]),
  );
  const update = vi.fn((table: unknown) =>
    table === vehiculo ? queryBuilder(undefined, opts.vehiculoUpdateError) : queryBuilder([clienteRow]),
  );
  const tx = { insert, update, select: vi.fn() } as unknown as TxLike;
  const transaction = vi.fn(async (fn: (t: TxLike) => Promise<unknown>) => fn(tx));
  const database = { transaction } as unknown as DatabaseDep;
  return { database, tx, transaction };
}

describe("createCliente (R16, R18)", () => {
  it("rejects invalid input before touching the DB", async () => {
    const insert = vi.fn();
    await expect(createCliente({ name: "" }, { insert })).rejects.toBeInstanceOf(ClienteValidationError);
    expect(insert).not.toHaveBeenCalled();
  });

  it("blocks creation and links to the existing customer on a duplicate phone", async () => {
    const insert = vi.fn();
    await expect(
      createCliente(validInput, {
        findByPhone: async () => ({ id: "existing-1" }) as unknown as Cliente,
        insert,
      }),
    ).rejects.toBeInstanceOf(DuplicatePhoneError);
    expect(insert).not.toHaveBeenCalled();
  });

  it("surfaces the existing customer's id on the duplicate error", async () => {
    await expect(
      createCliente(validInput, { findByPhone: async () => ({ id: "existing-1" }) as unknown as Cliente }),
    ).rejects.toMatchObject({ existingClienteId: "existing-1" });
  });

  it("creates the cliente (normalized phone) when the phone is not a duplicate", async () => {
    const insert = vi.fn().mockResolvedValue({ id: "c1", ...validInput, phone: "+525512345678" });
    const result = await createCliente(validInput, { findByPhone: async () => null, insert });
    expect(result).toEqual({ id: "c1", name: "Juan Pérez", phone: "+525512345678" });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ name: "Juan Pérez", phone: "+525512345678" }));
  });

  it("rejects invalid vehicle input before writing anything, even with an otherwise-valid cliente", async () => {
    const insert = vi.fn();
    await expect(
      createCliente(
        { ...validInput, vehicles: [{ make: "Toyota" }] },
        { findByPhone: async () => null, insert },
      ),
    ).rejects.toBeInstanceOf(ClienteValidationError);
    expect(insert).not.toHaveBeenCalled();
  });

  it("collects scalar AND vehicle field errors on one thrown error, not just the scalar ones", async () => {
    // validation.ts's contract is "ALL field errors collected (not just the
    // first)". Two sequential throws break it across the boundary: the user
    // fixes the name, resubmits, and only then learns the vehicle has no plate.
    const insert = vi.fn();
    await expect(
      createCliente({ name: "", phone: "5512345678", vehicles: [{ make: "Toyota" }] }, { insert }),
    ).rejects.toMatchObject({ errors: { name: expect.any(String), "vehicles.0.plate": expect.any(String) } });
    expect(insert).not.toHaveBeenCalled();
  });

  it("writes the cliente row and its vehicles in one transaction when vehicles are given (D5)", async () => {
    const clienteRow = { id: "c1", ...validInput, phone: "+525512345678" } as unknown as Cliente;
    const { database, tx } = fakeDatabase(clienteRow);

    const result = await createCliente(
      { ...validInput, vehicles: [{ plate: "ABC-123" }] },
      { findByPhone: async () => null, database },
    );

    expect(result).toEqual(clienteRow);
    expect(tx.insert).toHaveBeenCalledWith(cliente);
    expect(tx.insert).toHaveBeenCalledWith(vehiculo);
  });

  // NOT an atomicity test, deliberately: `fakeDatabase`'s `transaction` just
  // calls the callback, so there is no rollback to observe and nothing asserts
  // that the `cliente` insert was undone. What it does prove is that the
  // vehicle-side failure escapes `createCliente` instead of being swallowed
  // into a "created" result. Real rollback needs the live Postgres seam and is
  // owned by `vehicle search (E2E)`.
  it("propagates a vehicle-insert failure instead of swallowing it", async () => {
    const clienteRow = { id: "c1", ...validInput, phone: "+525512345678" } as unknown as Cliente;
    const { database } = fakeDatabase(clienteRow, { vehiculoInsertError: new Error("insert failed") });

    await expect(
      createCliente(
        { ...validInput, vehicles: [{ plate: "ABC-123" }] },
        { findByPhone: async () => null, database },
      ),
    ).rejects.toThrow("insert failed");
  });
});

describe("updateCliente (R16, R18)", () => {
  it("throws ClienteNotFoundError for a missing cliente", async () => {
    await expect(
      updateCliente("missing", { phone: "+525512345678" }, { getById: async () => null }),
    ).rejects.toBeInstanceOf(ClienteNotFoundError);
  });

  it("persists only the changed field (normalized), leaving the rest untouched", async () => {
    const current = {
      cliente: {
        id: "c1",
        name: "Juan Pérez",
        phone: "+525512345678",
        email: null,
      } as unknown as Cliente,
      orders: [],
      vehicles: [],
    };
    const update = vi.fn().mockResolvedValue({ ...current.cliente, phone: "+525599998888" });

    await updateCliente(
      "c1",
      { phone: "+52 55 9999 8888" },
      { getById: async () => current, findByPhone: async () => null, update },
    );

    expect(update).toHaveBeenCalledWith("c1", { phone: "+525599998888" });
  });

  it("does not flag a customer's own unchanged phone as a duplicate of itself", async () => {
    const current = {
      cliente: { id: "c1", name: "Juan Pérez", phone: "+525512345678" } as unknown as Cliente,
      orders: [],
      vehicles: [],
    };
    const findByPhone = vi.fn();
    const update = vi.fn().mockResolvedValue(current.cliente);

    await updateCliente("c1", { name: "Juan P." }, { getById: async () => current, findByPhone, update });

    expect(findByPhone).not.toHaveBeenCalled();
  });

  it("rejects an edit that would duplicate a different customer's phone", async () => {
    const current = {
      cliente: { id: "c1", name: "Juan", phone: "+525512345678" } as unknown as Cliente,
      orders: [],
      vehicles: [],
    };

    await expect(
      updateCliente(
        "c1",
        { phone: "+525599998888" },
        { getById: async () => current, findByPhone: async () => ({ id: "c2" }) as unknown as Cliente },
      ),
    ).rejects.toBeInstanceOf(DuplicatePhoneError);
  });

  it("rejects an update whose vehicles entry is missing a plate, without touching the DB", async () => {
    const current = {
      cliente: { id: "c1", name: "Juan", phone: "+525512345678" } as unknown as Cliente,
      orders: [],
      vehicles: [],
    };
    const update = vi.fn();

    await expect(
      updateCliente("c1", { vehicles: [{ make: "Toyota" }] }, { getById: async () => current, update }),
    ).rejects.toBeInstanceOf(ClienteValidationError);
    expect(update).not.toHaveBeenCalled();
  });

  it("leaves the vehicle collection completely untouched when vehicles is omitted from the patch (R16)", async () => {
    const current = {
      cliente: { id: "c1", name: "Juan Pérez", phone: "+525512345678" } as unknown as Cliente,
      orders: [],
      vehicles: [{ id: "v1", plate: "ABC111", deactivatedAt: null } as unknown as Vehiculo],
    };
    const clienteRow = { ...current.cliente };
    const { database, transaction } = fakeDatabase(clienteRow as unknown as Cliente);
    const update = vi.fn().mockResolvedValue(clienteRow);

    await updateCliente("c1", { name: "Juan P." }, { getById: async () => current, update, database });

    // No transaction opened at all — the plain scalar `deps.update` path runs,
    // exactly as it did before vehicles existed.
    expect(transaction).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith("c1", { name: "Juan P." });
  });

  it("reconciles the vehicle collection and the scalar patch in one transaction when vehicles is present (D5)", async () => {
    const current = {
      cliente: { id: "c1", name: "Juan Pérez", phone: "+525512345678" } as unknown as Cliente,
      orders: [],
      vehicles: [{ id: "v1", plate: "ABC111", deactivatedAt: null } as unknown as Vehiculo],
    };
    const clienteRow = { ...current.cliente, name: "Juan P." } as unknown as Cliente;
    const { database, tx } = fakeDatabase(clienteRow);

    const result = await updateCliente(
      "c1",
      { name: "Juan P.", vehicles: [{ plate: "XYZ999" }] },
      { getById: async () => current, database },
    );

    expect(result).toEqual(clienteRow);
    expect(tx.update).toHaveBeenCalledWith(cliente);
    // v1 (existing, active, omitted from the incoming payload) is deactivated;
    // the new plate is inserted.
    expect(tx.insert).toHaveBeenCalledWith(vehiculo);
    expect(tx.update).toHaveBeenCalledWith(vehiculo);
  });
});
