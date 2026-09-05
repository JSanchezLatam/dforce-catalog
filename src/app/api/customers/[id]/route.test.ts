import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Cliente } from "@/shared/db/schema";
import { ClienteNotFoundError } from "@/modules/customers/service";
import { handleUpdateCliente, PATCH } from "./route";

function requestWith(body: unknown, role = "tecnico") {
  return new NextRequest("http://localhost/api/customers/c1", {
    method: "PATCH",
    headers: { "x-user-id": "user-1", "x-user-role": role, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const current = {
  cliente: {
    id: "c1",
    name: "Juan Pérez",
    phone: "+525512345678",
    email: null,
    whatsappOptOut: false,
    emailOptOut: false,
  } as unknown as Cliente,
  orders: [],
  vehicles: [],
};

describe("permanent vehicle deletion is administrador-only", () => {
  /** The customer must actually OWN v1, or the reconcile rejects it as foreign (400) before any gate is observable. */
  const owningV1 = {
    ...current,
    vehicles: [
      { id: "v1", clienteId: "c1", plate: "ABC123", make: null, model: null, year: null, deactivatedAt: null, createdAt: new Date() },
    ],
  } as typeof current;

  /**
   * `updateCliente` reaches `deps.update` ONLY when the patch carries no
   * `vehicles` key; any vehicle patch goes through this transaction instead.
   * So this is the seam every case here actually runs on, and spying it is
   * what makes "never reaches the service" a claim with teeth — asserting
   * `update` was not called would hold identically with the gate and without
   * it, since nothing on this path can ever reach it.
   *
   * It returns the row without running the body on purpose: what the 200
   * cases assert is that the gate let the request reach persistence at all,
   * not what was written — the write itself is service.test.ts's and the
   * e2e's job.
   */
  const transaction = vi.fn();
  const database = {
    // The spy is a separate plain `vi.fn()` rather than the seam itself:
    // `vi.fn()` erases the generic and the result stops satisfying
    // `DatabaseDep`. Wrapping keeps the seam correctly typed and the call
    // still observable.
    transaction: async <T>(fn: unknown): Promise<T> => {
      transaction(fn);
      return current.cliente as T;
    },
  };

  /**
   * `customers.write` is not enough. Deactivation is reversible and every
   * tecnico keeps it; destroying the row is not, and this app routes every
   * other irreversible capability through `policy.ts`. The check reads the
   * RAW body deliberately — before validation, before the service — because
   * the grant governs whether the request may be considered at all, not
   * whether its payload is well-formed.
   */
  it("refuses a tecnico with 403 and never reaches the service", async () => {
    transaction.mockClear();

    const response = await handleUpdateCliente(
      requestWith({ vehicles: [{ id: "v1", plate: "ABC123", deleted: true }] }),
      "c1",
      { getById: async () => owningV1, database },
    );

    expect(response.status).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("lets an administrador through", async () => {
    transaction.mockClear();

    const response = await handleUpdateCliente(
      requestWith({ vehicles: [{ id: "v1", plate: "ABC123", deleted: true }] }, "administrador"),
      "c1",
      { getById: async () => owningV1, database },
    );

    expect(response.status).toBe(200);
    expect(transaction).toHaveBeenCalled();
  });

  /** The gate is scoped to deletion: a tecnico's ordinary vehicle edit is untouched. */
  it("still lets a tecnico deactivate and edit vehicles", async () => {
    transaction.mockClear();

    const response = await handleUpdateCliente(
      requestWith({ vehicles: [{ id: "v1", plate: "ABC123", deactivated: true }] }),
      "c1",
      { getById: async () => owningV1, database },
    );

    expect(response.status).toBe(200);
    expect(transaction).toHaveBeenCalled();
  });
});

describe("PATCH /api/customers/[id] (R16)", () => {
  it("throws when called without session headers", async () => {
    const request = new NextRequest("http://localhost/api/customers/c1", {
      method: "PATCH",
      body: JSON.stringify({ name: "Nuevo" }),
    });
    await expect(PATCH(request, { params: Promise.resolve({ id: "c1" }) })).rejects.toThrow();
  });

  it("persists only the changed field and returns 200 (R16)", async () => {
    const update = vi.fn().mockResolvedValue({ ...current.cliente, name: "Juan P." });

    const response = await handleUpdateCliente(requestWith({ name: "Juan P." }), "c1", {
      getById: async () => current,
      update,
    });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith("c1", { name: "Juan P." });
  });

  it("toggles whatsappOptOut/emailOptOut independently (R26)", async () => {
    const update = vi.fn().mockResolvedValue({ ...current.cliente, whatsappOptOut: true });

    await handleUpdateCliente(requestWith({ whatsappOptOut: true }), "c1", {
      getById: async () => current,
      update,
    });

    expect(update).toHaveBeenCalledWith("c1", { whatsappOptOut: true });
  });

  it("returns 404 for a missing cliente", async () => {
    const response = await handleUpdateCliente(requestWith({ name: "x" }), "missing", {
      getById: async () => null,
    });
    expect(response.status).toBe(404);
  });

  it("returns 409 on a duplicate-phone edit (R18)", async () => {
    const response = await handleUpdateCliente(requestWith({ phone: "+525599998888" }), "c1", {
      getById: async () => current,
      findByPhone: async () => ({ id: "c2" }) as unknown as Cliente,
    });
    expect(response.status).toBe(409);
  });

  // Same guarantee as the POST route: the body is forwarded whole, and this is
  // what keeps it that way.
  it("carries the shared-phone confirmation through to the service on edit (R18)", async () => {
    const update = vi.fn().mockResolvedValue(current.cliente);

    const response = await handleUpdateCliente(
      requestWith({ phone: "+525599998888", allowDuplicatePhone: true }),
      "c1",
      { getById: async () => current, findByPhone: async () => ({ id: "c2" }) as unknown as Cliente, update },
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledOnce();
  });

  it("returns 400 on a validation error", async () => {
    const response = await handleUpdateCliente(requestWith({ name: "" }), "c1", {
      getById: async () => current,
    });
    expect(response.status).toBe(400);
  });

  it("returns 400 for a vehicles entry missing its plate, unchanged error mapping (D5/D6)", async () => {
    const response = await handleUpdateCliente(requestWith({ vehicles: [{ make: "Toyota" }] }), "c1", {
      getById: async () => current,
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors["vehicles.0.plate"]).toBeTruthy();
  });
});

/**
 * R20 — activation rides the same PATCH as field edits, the idiom
 * `api/users/[id]/route.ts` already uses for `body.active`. Gated on
 * `customers.write` (design D2): deactivation is reversible, so it needs no
 * grant of its own.
 */
describe("PATCH /api/customers/[id] — activation (R20)", () => {
  it("deactivates on active:false and never sends `active` on to updateCliente", async () => {
    const deactivateCliente = vi.fn().mockResolvedValue(current.cliente);
    const update = vi.fn();

    const response = await handleUpdateCliente(requestWith({ active: false }), "c1", {
      getById: async () => current,
      update,
      deactivateCliente,
    });

    expect(response.status).toBe(200);
    expect(deactivateCliente).toHaveBeenCalledWith("c1");
    // `active` is not a column. Forwarded, it would become a SET on one that
    // does not exist - the same trap `allowDuplicatePhone` had to dodge.
    expect(update).not.toHaveBeenCalled();
  });

  it("reactivates on active:true", async () => {
    const reactivateCliente = vi.fn().mockResolvedValue(current.cliente);

    const response = await handleUpdateCliente(requestWith({ active: true }), "c1", {
      getById: async () => current,
      reactivateCliente,
    });

    expect(response.status).toBe(200);
    expect(reactivateCliente).toHaveBeenCalledWith("c1");
  });

  // The order is not arbitrary. `updateCliente` refuses to edit a deactivated
  // record (D5), so reactivation has to land BEFORE the field edits or an
  // "edit and reactivate" save would be rejected by its own first step.
  it("reactivates BEFORE applying field edits in the same request", async () => {
    const calls: string[] = [];
    const reactivateCliente = vi.fn(async () => {
      calls.push("reactivate");
      return current.cliente;
    });
    const update = vi.fn(async () => {
      calls.push("update");
      return current.cliente;
    });

    await handleUpdateCliente(requestWith({ active: true, name: "Nuevo" }), "c1", {
      getById: async () => current,
      update,
      reactivateCliente,
    });

    expect(calls).toEqual(["reactivate", "update"]);
  });

  it("lets a tecnico deactivate — no grant of its own (D2)", async () => {
    const response = await handleUpdateCliente(
      new NextRequest("http://localhost/api/customers/c1", {
        method: "PATCH",
        headers: { "x-user-id": "u1", "x-user-role": "tecnico" },
        body: JSON.stringify({ active: false }),
      }),
      "c1",
      { getById: async () => current, deactivateCliente: vi.fn() },
    );
    // `tecnico` HOLDS customers.write (policy.ts), so this must succeed - the
    // assertion pins design D2's "no new grant", not a denial.
    expect(response.status).toBe(200);
  });

  // Named for what it actually proves: the route's job here is the
  // error-to-status MAPPING. That the service refuses to write blind is a
  // service-level claim, tested in `service.test.ts` with an injected
  // `setDeactivatedAt` - and verified by mutation, unlike this one, which
  // hand-feeds the rejection and would pass even if the service stopped
  // throwing.
  it("maps ClienteNotFoundError to 404", async () => {
    const deactivateCliente = vi.fn().mockRejectedValue(new ClienteNotFoundError("missing"));

    const response = await handleUpdateCliente(requestWith({ active: false }), "missing", {
      getById: async () => null,
      deactivateCliente,
    });

    expect(response.status).toBe(404);
  });

  it("maps an edit to a deactivated cliente to 409, not a silent no-op", async () => {
    const deactivated = {
      cliente: { ...current.cliente, deactivatedAt: new Date("2026-09-01") } as unknown as Cliente,
      orders: [],
      vehicles: [],
    };

    const response = await handleUpdateCliente(requestWith({ name: "Nuevo" }), "c1", {
      getById: async () => deactivated,
      update: vi.fn(),
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("cliente_deactivated");
  });
});
