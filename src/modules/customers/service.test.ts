import { describe, expect, it, vi } from "vitest";

import type { Cliente } from "@/shared/db/schema";
import { ClienteNotFoundError, createCliente, DuplicatePhoneError, updateCliente } from "./service";
import { ClienteValidationError } from "./validation";

const validInput = { name: "Juan Pérez", phone: "+52 55 1234 5678" };

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
        vehicleMake: null,
        vehicleModel: null,
        vehicleYear: null,
        vehiclePlate: null,
      } as unknown as Cliente,
      orders: [],
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
    };

    await expect(
      updateCliente(
        "c1",
        { phone: "+525599998888" },
        { getById: async () => current, findByPhone: async () => ({ id: "c2" }) as unknown as Cliente },
      ),
    ).rejects.toBeInstanceOf(DuplicatePhoneError);
  });

  it("rejects a patch that violates the vehicle-requires-plate rule against the merged record", async () => {
    const current = {
      cliente: { id: "c1", name: "Juan", phone: "+525512345678", vehiclePlate: null } as unknown as Cliente,
      orders: [],
    };

    await expect(
      updateCliente("c1", { vehicleMake: "Toyota" }, { getById: async () => current }),
    ).rejects.toBeInstanceOf(ClienteValidationError);
  });
});
