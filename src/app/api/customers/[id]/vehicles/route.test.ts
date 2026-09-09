import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Cliente, Vehiculo } from "@/shared/db/schema";
import { GET, handleCreateVehiculo, handleListVehiculosByCliente, POST } from "./route";

function requestFor(id: string, headers: Record<string, string> = { "x-user-id": "u1", "x-user-role": "tecnico" }) {
  return new NextRequest(`http://localhost/api/customers/${id}/vehicles`, { headers });
}

function fakeVehiculo(overrides: Partial<Vehiculo> = {}): Vehiculo {
  return {
    id: "v1",
    clienteId: "c1",
    make: "Toyota",
    model: "Corolla",
    year: 2020,
    plate: "ABC111",
    deactivatedAt: null,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("GET /api/customers/[id]/vehicles (C4, task 1.11 — the gap D2 found)", () => {
  it("throws when called without session headers", async () => {
    await expect(
      GET(new NextRequest("http://localhost/api/customers/c1/vehicles"), { params: Promise.resolve({ id: "c1" }) }),
    ).rejects.toThrow();
  });

  it("403s a user without customers.read", async () => {
    // No role in policy.ts's MATRIX grants false for customers.read today,
    // so this is exercised via an unknown role instead of a real denial.
    const response = await handleListVehiculosByCliente(requestFor("c1", { "x-user-id": "u1", "x-user-role": "unknown" }), "c1");
    expect(response.status).toBe(403);
  });

  // Delegation only. "active-only" is a property of `listVehiculosByCliente`
  // itself and is proven in `vehicles.test.ts`; injecting a fake here cannot
  // prove it, and a name claiming otherwise sells coverage that isn't here.
  it("delegates to listVehiculosByCliente with the customer id and returns its rows", async () => {
    const listVehiculosByCliente = vi.fn().mockResolvedValue([fakeVehiculo()]);
    const response = await handleListVehiculosByCliente(requestFor("c1"), "c1", { listVehiculosByCliente });

    expect(response.status).toBe(200);
    expect(listVehiculosByCliente).toHaveBeenCalledWith("c1");
    const body = await response.json();
    expect(body.vehicles).toEqual([expect.objectContaining({ id: "v1", plate: "ABC111" })]);
  });
});

/**
 * D10 — every body below enters through the HANDLER as JSON, never as a
 * hand-typed literal: `postRequest` stringifies exactly what a browser would
 * send and `handleCreateVehiculo` parses it back with `request.json()`. That
 * is the whole point. `POST /api/service-orders` shipped unable to save
 * because its route forwarded a JSON string into a field declared `Date`, and
 * every unit test handed the function an already-typed object so the suite
 * stayed green. A literal here would re-buy that same blind spot: the
 * `year: "2019"` case below cannot exist at all once TypeScript has already
 * agreed the value is a number.
 *
 * Each case asserts what the injected seam RECEIVED, not that the call
 * resolved — a fake `createVehiculo` accepts anything.
 */
function postRequest(
  id: string,
  body: unknown,
  headers: Record<string, string> = { "x-user-id": "u1", "x-user-role": "tecnico" },
) {
  return new NextRequest(`http://localhost/api/customers/${id}/vehicles`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function clienteRow(overrides: Partial<Cliente> = {}): Cliente {
  return {
    id: "c1",
    name: "Cliente Uno",
    phone: "50761111111",
    email: null,
    whatsappOptOut: false,
    emailOptOut: false,
    deactivatedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  } as Cliente;
}

/** An active customer, found. The default for every case that is not about the record. */
function activeCustomerDeps(createVehiculo = vi.fn().mockResolvedValue(fakeVehiculo())) {
  return {
    getClienteById: vi.fn().mockResolvedValue({ cliente: clienteRow(), orders: [], vehicles: [] }),
    createVehiculo,
  };
}

describe("POST /api/customers/[id]/vehicles (D1/D3/D10 — the single insert)", () => {
  it("throws when called without session headers", async () => {
    await expect(
      POST(
        new NextRequest("http://localhost/api/customers/c1/vehicles", { method: "POST", body: "{}" }),
        { params: Promise.resolve({ id: "c1" }) },
      ),
    ).rejects.toThrow();
  });

  it("403s a user without customers.write before touching the database", async () => {
    const deps = activeCustomerDeps();
    const response = await handleCreateVehiculo(
      postRequest("c1", { plate: "NEW111" }, { "x-user-id": "u1", "x-user-role": "unknown" }),
      "c1",
      deps,
    );
    expect(response.status).toBe(403);
    expect(deps.getClienteById).not.toHaveBeenCalled();
    expect(deps.createVehiculo).not.toHaveBeenCalled();
  });

  // D10 — `validateVehiculoInput` keeps `year` only when it is already a
  // `number`, so an unguarded route DROPS `"2019"` and writes a yearless row
  // while answering 201. Refused instead, the way the route next door refuses
  // a non-boolean `active` rather than coercing it.
  it("400s a string year rather than silently dropping it", async () => {
    const deps = activeCustomerDeps();
    const response = await handleCreateVehiculo(postRequest("c1", { plate: "NEW111", year: "2019" }), "c1", deps);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ errors: { year: "Año inválido" } });
    expect(deps.createVehiculo).not.toHaveBeenCalled();
  });

  it("passes a numeric year through to createVehiculo as a number", async () => {
    const deps = activeCustomerDeps();
    const response = await handleCreateVehiculo(
      postRequest("c1", { plate: "NEW111", make: "Toyota", model: "Corolla", year: 2019 }),
      "c1",
      deps,
    );
    expect(response.status).toBe(201);
    expect(deps.createVehiculo).toHaveBeenCalledWith("c1", {
      plate: "NEW111",
      make: "Toyota",
      model: "Corolla",
      year: 2019,
    });
  });

  // D1's trust boundary. `validateVehiculoInput`'s return type is
  // collection-shaped — it accepts `id`, `deleted` and `deactivated`, and it
  // permits `plate: ""` when `deleted === true`, which is exactly the
  // plate-less row migration 0013's pre-flight guard aborts on. Dropping them
  // would be the quiet option; this route refuses.
  it.each(["id", "deleted", "deactivated"])("400s a body carrying %s rather than dropping it", async (field) => {
    const deps = activeCustomerDeps();
    const response = await handleCreateVehiculo(
      postRequest("c1", { plate: "NEW111", [field]: field === "id" ? "v-otro" : true }),
      "c1",
      deps,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty(`errors.${field}`);
    expect(deps.createVehiculo).not.toHaveBeenCalled();
  });

  // Reuses the existing per-vehicle rule from `validateVehiculoInput` — the
  // Spanish string is that function's, not a second copy of it here.
  it("400s a payload with make and no plate, reusing the existing plate-required rule", async () => {
    const deps = activeCustomerDeps();
    const response = await handleCreateVehiculo(postRequest("c1", { make: "Toyota" }), "c1", deps);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ errors: { plate: "La placa es obligatoria" } });
    expect(deps.createVehiculo).not.toHaveBeenCalled();
  });

  // D3 — the codes the neighbours already use: the caller is permitted, the
  // RECORD is what refuses. Both answers come from one `getClienteById`.
  it("404s an unknown customer", async () => {
    const deps = { getClienteById: vi.fn().mockResolvedValue(null), createVehiculo: vi.fn() };
    const response = await handleCreateVehiculo(postRequest("c-nope", { plate: "NEW111" }), "c-nope", deps);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(deps.createVehiculo).not.toHaveBeenCalled();
  });

  it("409s a deactivated customer", async () => {
    const deps = {
      getClienteById: vi
        .fn()
        .mockResolvedValue({ cliente: clienteRow({ deactivatedAt: new Date("2026-02-01") }), orders: [], vehicles: [] }),
      createVehiculo: vi.fn(),
    };
    const response = await handleCreateVehiculo(postRequest("c1", { plate: "NEW111" }), "c1", deps);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "cliente_deactivated" });
    expect(deps.createVehiculo).not.toHaveBeenCalled();
  });

  it("201s with the inserted row, looking the customer up exactly once", async () => {
    const created = fakeVehiculo({ id: "v-new", plate: "NEW111" });
    const deps = activeCustomerDeps(vi.fn().mockResolvedValue(created));
    const response = await handleCreateVehiculo(postRequest("c1", { plate: "NEW111" }), "c1", deps);
    expect(response.status).toBe(201);
    expect(deps.getClienteById).toHaveBeenCalledTimes(1);
    expect((await response.json()).vehiculo).toEqual(expect.objectContaining({ id: "v-new", plate: "NEW111" }));
  });

  // D4's other half, from the server side: the route has no way to address a
  // `cliente` column, so a body that tries reaches `createVehiculo` stripped.
  // `whatsappOptOut`/`emailOptOut` are legally distinct consent regimes
  // (AGENTS.md) and nothing on this path may touch them.
  it("never forwards a cliente field, consent booleans included", async () => {
    const deps = activeCustomerDeps();
    await handleCreateVehiculo(
      postRequest("c1", { plate: "NEW111", whatsappOptOut: true, emailOptOut: true, name: "Otro Nombre" }),
      "c1",
      deps,
    );
    const [, forwarded] = deps.createVehiculo.mock.calls[0];
    expect(forwarded).toEqual({ plate: "NEW111" });
  });
});
