import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Cliente } from "@/shared/db/schema";
import type { ClienteListItem } from "@/modules/customers/queries";
import { handleCreateCliente, handleListClientes, POST } from "./route";

const validInput = { name: "Juan Pérez", phone: "+52 55 1234 5678" };

function requestWith(body: unknown) {
  return new NextRequest("http://localhost/api/customers", {
    method: "POST",
    headers: { "x-user-id": "user-1", "x-user-role": "tecnico", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/customers (R16)", () => {
  it("throws when called without session headers (proxy.ts did not validate)", async () => {
    const request = new NextRequest("http://localhost/api/customers", {
      method: "POST",
      body: JSON.stringify(validInput),
    });
    await expect(POST(request)).rejects.toThrow();
  });

  it("creates the cliente and returns 201 on valid input", async () => {
    const insert = vi.fn().mockResolvedValue({ id: "c1", ...validInput, phone: "+525512345678" });

    const response = await handleCreateCliente(requestWith(validInput), {
      findByPhone: async () => null,
      insert,
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.cliente).toEqual({ id: "c1", name: "Juan Pérez", phone: "+525512345678" });
  });

  it("returns 400 with field errors on invalid input (R17)", async () => {
    const response = await handleCreateCliente(requestWith({ name: "" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors.name).toBeTruthy();
    expect(body.errors.phone).toBeTruthy();
  });

  it("returns 409 with a link to the existing customer on a duplicate phone (R18)", async () => {
    const response = await handleCreateCliente(requestWith(validInput), {
      findByPhone: async () => ({ id: "existing-1" }) as unknown as Cliente,
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.existingClienteId).toBe("existing-1");
  });
});

function getReq(role: string, query = "") {
  return new NextRequest(`http://localhost/api/customers${query}`, {
    headers: { "x-user-id": "user-1", "x-user-role": role },
  });
}

const ROW: ClienteListItem = {
  id: "c1",
  name: "Juan",
  phone: null,
  email: null,
  vehiclePlate: null,
  createdAt: new Date("2026-01-01"),
};

/**
 * Spec `customer-management` R19 — "GET route requires customers.read".
 * Mirrors `api/users/route.test.ts`'s "denies ... without listing anything"
 * shape: asserting the injected spies were never called proves the deny
 * branch runs before any query, not just that the status code is 403.
 */
describe("customers.read gating (R19)", () => {
  it("denies an unrecognised role on GET without running any query", async () => {
    const listClientes = vi.fn();
    const countClientes = vi.fn();

    const response = await handleListClientes(getReq("unknown"), { listClientes, countClientes });

    expect(response.status).toBe(403);
    expect(listClientes).not.toHaveBeenCalled();
    expect(countClientes).not.toHaveBeenCalled();
  });

  it("throws on GET without session headers (proxy.ts did not validate)", async () => {
    const bare = new NextRequest("http://localhost/api/customers");
    await expect(handleListClientes(bare, {})).rejects.toThrow();
  });
});

describe("GET /api/customers (R19)", () => {
  it("parses search/page/pageSize and clamps pageSize to a known option", async () => {
    const listClientes = vi.fn().mockResolvedValue([ROW]);
    const countClientes = vi.fn().mockResolvedValue(1);

    await handleListClientes(getReq("tecnico", "?search=juan&page=2&pageSize=25"), { listClientes, countClientes });

    expect(listClientes).toHaveBeenCalledWith({ search: "juan" }, { page: 2, offset: 25, limit: 25 });
    expect(countClientes).toHaveBeenCalledWith({ search: "juan" });
  });

  it("defaults to page 1 and the standard page size with no query string", async () => {
    const listClientes = vi.fn().mockResolvedValue([ROW]);
    const countClientes = vi.fn().mockResolvedValue(1);

    await handleListClientes(getReq("tecnico"), { listClientes, countClientes });

    expect(listClientes).toHaveBeenCalledWith({ search: undefined }, { page: 1, offset: 0, limit: 10 });
  });

  it("re-queries with a relaxed term and sets relaxedFrom only when the primary search returns zero rows", async () => {
    const listClientes = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([ROW]);
    const countClientes = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const response = await handleListClientes(getReq("tecnico", "?search=Juan+Alberto"), {
      listClientes,
      countClientes,
    });

    const body = await response.json();
    expect(listClientes).toHaveBeenCalledTimes(2);
    expect(listClientes).toHaveBeenNthCalledWith(2, { search: "Juan" }, expect.any(Object));
    expect(body.relaxedFrom).toBe("Juan");
    expect(body.total).toBe(1);
  });

  it("does not re-query when the primary search already has results", async () => {
    const listClientes = vi.fn().mockResolvedValue([ROW]);
    const countClientes = vi.fn().mockResolvedValue(1);

    const response = await handleListClientes(getReq("tecnico", "?search=Juan"), { listClientes, countClientes });

    expect(listClientes).toHaveBeenCalledTimes(1);
    expect((await response.json()).relaxedFrom).toBeUndefined();
  });

  it("suppresses the second query when relaxSearchTerm returns null (term too short to relax)", async () => {
    const listClientes = vi.fn().mockResolvedValue([]);
    const countClientes = vi.fn().mockResolvedValue(0);

    await handleListClientes(getReq("tecnico", "?search=abc"), { listClientes, countClientes });

    expect(listClientes).toHaveBeenCalledTimes(1);
  });
});
