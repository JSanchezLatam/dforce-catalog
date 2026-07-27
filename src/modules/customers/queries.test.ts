import { describe, expect, it } from "vitest";

import type { Cliente, OrdenServicio } from "@/shared/db/schema";
import { buildClienteSearchWhere, countClientes, findClienteByPhone, getClienteById, listClientes } from "./queries";

describe("buildClienteSearchWhere (R19)", () => {
  it("returns undefined when no search term is given", () => {
    expect(buildClienteSearchWhere(undefined)).toBeUndefined();
  });

  it("returns undefined for a blank/whitespace-only search term", () => {
    expect(buildClienteSearchWhere("   ")).toBeUndefined();
  });

  it("returns a defined condition when a search term is given (matches name/phone/plate)", () => {
    expect(buildClienteSearchWhere("juan")).toBeDefined();
  });
});

describe("listClientes (R19)", () => {
  it("returns whatever the injected queryFn resolves", async () => {
    const rows = [
      { id: "c1", name: "Juan", phone: "+525512345678", email: null, vehiclePlate: null, createdAt: new Date() },
    ];
    await expect(
      listClientes({ search: "juan" }, { offset: 0, limit: 10 }, async () => rows as unknown as Cliente[]),
    ).resolves.toEqual(rows);
  });
});

describe("countClientes (R19)", () => {
  it("returns whatever the injected queryFn resolves", async () => {
    await expect(countClientes({}, async () => 5)).resolves.toBe(5);
  });
});

describe("getClienteById (R16)", () => {
  it("returns null when the injected queryFn finds nothing", async () => {
    await expect(getClienteById("missing", async () => null)).resolves.toBeNull();
  });

  it("returns the cliente + its service-order history (most-recent first is the queryFn's contract)", async () => {
    const detail = {
      cliente: { id: "c1", name: "Juan" } as unknown as Cliente,
      orders: [{ id: "o2" }, { id: "o1" }] as unknown as OrdenServicio[],
    };
    await expect(getClienteById("c1", async () => detail)).resolves.toEqual(detail);
  });
});

describe("findClienteByPhone (R18)", () => {
  it("returns null when no row matches", async () => {
    await expect(findClienteByPhone("+525512345678", async () => [])).resolves.toBeNull();
  });

  it("returns the matching row when found", async () => {
    const row = { id: "c1", phone: "+525512345678" } as unknown as Cliente;
    await expect(findClienteByPhone("+525512345678", async () => [row])).resolves.toEqual(row);
  });
});
