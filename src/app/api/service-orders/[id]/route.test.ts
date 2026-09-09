import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/modules/auth/roles";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import type { OrdenServicio } from "@/shared/db/schema";
import { handleUpdateOrdenServicio, PATCH } from "./route";

/**
 * D11 flipped this default from `tecnico`. The field-patch cases below all run
 * against an `open` order, and `canEditOrderFields` refuses `tecnico` there —
 * so as `tecnico` every one of them would assert a 403 it was never written to
 * describe. `administrador` keeps them exercising the branch they were written
 * for; the role gate itself is covered by its own cases at the bottom, which
 * pass a role explicitly. Both roles hold `service-orders.write`
 * (`policy.ts:30`, `:43`), so the coarse gate above is unaffected either way.
 */
function requestWith(body: unknown, role: Role = "administrador") {
  return new NextRequest("http://localhost/api/service-orders/o1", {
    method: "PATCH",
    headers: { "x-user-id": "user-1", "x-user-role": role, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Every `orden_servicio` column (schema.ts:412-438), not the four the older
 * assertions happen to read — AGENTS.md: "a mock more convenient than reality
 * tests the mock, not the code." The full row is also what drops the
 * `as unknown as OrdenServicio` cast this fixture used to need.
 */
function ordenWith(status: OrderStatus): OrdenServicio {
  return {
    id: "o1",
    clienteId: "cli-1",
    vehiculoId: "veh-1",
    status,
    categoria: "revisado",
    description: null,
    appointmentAt: null,
    completedAt: null,
    hallazgos: null,
    recomendaciones: null,
    observaciones: null,
    createdBy: null,
    createdAt: new Date("2026-05-01T14:00:00Z"),
    updatedAt: new Date("2026-05-01T14:00:00Z"),
  };
}

function detailWith(status: OrderStatus) {
  return { orden: ordenWith(status), items: [] };
}

const current = detailWith("open");

function fakeDb(updated: Partial<OrdenServicio>) {
  return {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => [{ ...current.orden, ...updated }],
        }),
      }),
    }),
  };
}

describe("PATCH /api/service-orders/[id] (R21)", () => {
  it("throws when called without session headers", async () => {
    const request = new NextRequest("http://localhost/api/service-orders/o1", {
      method: "PATCH",
      body: JSON.stringify({ status: "in_progress" }),
    });
    await expect(PATCH(request, { params: Promise.resolve({ id: "o1" }) })).rejects.toThrow();
  });

  it("drives a valid status transition and returns 200", async () => {
    const response = await handleUpdateOrdenServicio(requestWith({ status: "in_progress" }), "o1", {
      getById: async () => current,
      db: fakeDb({ status: "in_progress" }) as never,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.orden.status).toBe("in_progress");
  });

  it("rejects an invalid transition with 400 (R21)", async () => {
    const response = await handleUpdateOrdenServicio(
      requestWith({ status: "done" }),
      "o1",
      { getById: async () => current },
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 for a missing order", async () => {
    const response = await handleUpdateOrdenServicio(requestWith({ status: "in_progress" }), "missing", {
      getById: async () => null,
    });
    expect(response.status).toBe(404);
  });

  it("updates plain fields (description/appointmentAt) without a status transition", async () => {
    const update = vi.fn();
    const response = await handleUpdateOrdenServicio(
      requestWith({ description: "Cambio de aceite" }),
      "o1",
      {
        getById: async () => current,
        db: {
          update: (...args: unknown[]) => {
            update(...args);
            return {
              set: () => ({
                where: () => ({ returning: async () => [{ ...current.orden, description: "Cambio de aceite" }] }),
              }),
            };
          },
        } as never,
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.orden.description).toBe("Cambio de aceite");
  });

  it("updates categoria and the 3 note fields (task 2.3)", async () => {
    const setSpy = vi.fn(() => ({
      where: () => ({
        returning: async () => [
          {
            ...current.orden,
            categoria: "reparacion",
            hallazgos: "Fuga de aceite",
            recomendaciones: "Cambiar empaque",
            observaciones: "Cliente notificado",
          },
        ],
      }),
    }));

    const response = await handleUpdateOrdenServicio(
      requestWith({
        categoria: "reparacion",
        hallazgos: "Fuga de aceite",
        recomendaciones: "Cambiar empaque",
        observaciones: "Cliente notificado",
      }),
      "o1",
      { getById: async () => current, db: { update: () => ({ set: setSpy }) } as never },
    );

    expect(response.status).toBe(200);
    // Proves the route actually PASSED these fields into the patch, not just
    // that the returned row echoes what a fake DB was told to return.
    expect(setSpy).toHaveBeenCalledWith({
      categoria: "reparacion",
      hallazgos: "Fuga de aceite",
      recomendaciones: "Cambiar empaque",
      observaciones: "Cliente notificado",
    });
  });

  /**
   * Whitelist pin (task 2.3, mirrors service.ts's task-1.8 pattern): a stray
   * field in the PATCH body (here `vehiculoId` — the order's vehicle is
   * immutable post-creation per design.md) must never reach `updateOrder`'s
   * patch, even though the route reads `body` freely.
   */
  // Also the pin for task 2.10's client-side contract: the form OMITS
  // appointmentAt when untouched, and that is only safe because an absent
  // key never reaches the patch — updateOrder then skips the reminder
  // cancel/reschedule entirely. Asserting `.set()` was called with EXACTLY
  // the whitelisted fields is what proves it; a separate test for the same
  // mutation would have been a second name for this assertion.
  it("whitelists exactly description/appointmentAt/categoria/3 notes — a stray field is ignored", async () => {
    const setSpy = vi.fn(() => ({
      where: () => ({ returning: async () => [{ ...current.orden, categoria: "revisado" }] }),
    }));

    const response = await handleUpdateOrdenServicio(
      requestWith({ categoria: "revisado", vehiculoId: "sneaky-vehicle-swap" }),
      "o1",
      {
        getById: async () => current,
        db: { update: () => ({ set: setSpy }) } as never,
      },
    );

    expect(response.status).toBe(200);
    expect(setSpy).toHaveBeenCalledWith({ categoria: "revisado" });
  });
  it("rejects a categoria outside the enum with 400, without ever reaching the update", async () => {
    const setSpy = vi.fn();

    const response = await handleUpdateOrdenServicio(requestWith({ categoria: "banana" }), "o1", {
      getById: async () => current,
      db: { update: () => ({ set: setSpy }) } as never,
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toHaveProperty("categoria");
    expect(setSpy).not.toHaveBeenCalled();
  });

  /**
   * GGA round 1 on PR2. `categoria` got a guard that explicitly rejects
   * non-strings — for the one field with a downstream backstop, the PG enum
   * cast. The three free-text columns have none and got nothing, which is
   * backwards. `description` is folded in for the same reason: it is the same
   * column type reached through the same unchecked assignment.
   */
  it.each(["hallazgos", "recomendaciones", "observaciones", "description"])(
    "rejects a non-string %s with 400, without reaching the update",
    async (field) => {
      const setSpy = vi.fn();

      const response = await handleUpdateOrdenServicio(requestWith({ [field]: { evil: 1 } }), "o1", {
        getById: async () => current,
        db: { update: () => ({ set: setSpy }) } as never,
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.errors).toHaveProperty(field);
      expect(setSpy).not.toHaveBeenCalled();
    },
  );

  it("rejects a note longer than the bound, without reaching the update", async () => {
    const setSpy = vi.fn();

    const response = await handleUpdateOrdenServicio(requestWith({ hallazgos: "x".repeat(5001) }), "o1", {
      getById: async () => current,
      db: { update: () => ({ set: setSpy }) } as never,
    });

    expect(response.status).toBe(400);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("still accepts null on a note field — clearing one is not the same as smuggling an object", async () => {
    const setSpy = vi.fn(() => ({
      where: () => ({ returning: async () => [{ ...current.orden, hallazgos: null }] }),
    }));

    const response = await handleUpdateOrdenServicio(requestWith({ hallazgos: null }), "o1", {
      getById: async () => current,
      db: { update: () => ({ set: setSpy }) } as never,
    });

    expect(response.status).toBe(200);
    expect(setSpy).toHaveBeenCalledWith({ hallazgos: null });
  });

  /**
   * GGA round 2 on PR2. `new Date("no soy una fecha")` is an Invalid Date, not
   * a throw. It reached `.set()` and the driver rejected it — but the wider
   * damage is `updateOrder`'s reminder logic, which compares
   * `patch.appointmentAt?.getTime() ?? null` to decide whether to cancel and
   * reschedule: NaN !== null, so an Invalid Date reads as a CHANGED
   * appointment and would cancel a real pending reminder if the write landed.
   */
  it("rejects an unparseable appointmentAt with 400, without reaching the update", async () => {
    const setSpy = vi.fn();

    const response = await handleUpdateOrdenServicio(requestWith({ appointmentAt: "no soy una fecha" }), "o1", {
      getById: async () => current,
      db: { update: () => ({ set: setSpy }) } as never,
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toHaveProperty("appointmentAt");
    expect(setSpy).not.toHaveBeenCalled();
  });

  /**
   * `new Date(null)` is the epoch, not an Invalid Date, so round 2's
   * Number.isNaN guard would wave a clear straight through to a 1970 write —
   * and, by updateOrder's getTime() comparison, cancel the customer's reminder
   * and reschedule it there. The route checks for null BEFORE parsing, which
   * is what makes that safe; nothing asserted it.
   */
  it("clears the appointment as null, never as the epoch", async () => {
    const setSpy = vi.fn(() => ({
      where: () => ({ returning: async () => [{ ...current.orden, appointmentAt: null }] }),
    }));

    const response = await handleUpdateOrdenServicio(requestWith({ appointmentAt: null }), "o1", {
      getById: async () => current,
      db: { update: () => ({ set: setSpy }) } as never,
    });

    expect(response.status).toBe(200);
    expect(setSpy).toHaveBeenCalledWith({ appointmentAt: null });
  });

  /**
   * GGA round 1 on PR2, finding 3. Pre-existing — the hole was the same when
   * the whitelist was description/appointmentAt — but this is the PR that
   * pinned "read the body freely, drop what you don't recognise" into a tested
   * contract, so an all-stray body reaching `.set({})` is now this PR's to own.
   */
  it("refuses a patch that whitelists down to nothing instead of calling .set({})", async () => {
    const setSpy = vi.fn();

    const response = await handleUpdateOrdenServicio(requestWith({ vehiculoId: "sneaky-vehicle-swap" }), "o1", {
      getById: async () => current,
      db: { update: () => ({ set: setSpy }) } as never,
    });

    expect(response.status).toBe(400);
    expect(setSpy).not.toHaveBeenCalled();
  });
});

/**
 * D11 — the fine-grained `(role, status)` gate, which runs AFTER the coarse
 * `service-orders.write` check both roles pass. The UI consults the same
 * predicate to decide whether to render the control; these cases are what
 * prove the route consults it too, which a green `edit-policy.test.ts` says
 * nothing about.
 */
describe("PATCH /api/service-orders/[id] — the edit gate (D11)", () => {
  it("refuses a tecnico patching an OPEN order with 403, without reaching the update", async () => {
    const setSpy = vi.fn();

    const response = await handleUpdateOrdenServicio(
      requestWith({ hallazgos: "Fuga de aceite" }, "tecnico"),
      "o1",
      { getById: async () => detailWith("open"), db: { update: () => ({ set: setSpy }) } as never },
    );

    expect(response.status).toBe(403);
    // AGENTS.md binds this to the exact Spanish string — never loosened to
    // match both languages, that is what catches an untranslated screen.
    expect(await response.json()).toEqual({
      errors: { form: "Solo un administrador puede editar una orden abierta." },
    });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("refuses an administrador patching a DONE order with 409, without reaching the update", async () => {
    const setSpy = vi.fn();

    const response = await handleUpdateOrdenServicio(
      requestWith({ hallazgos: "Fuga de aceite" }, "administrador"),
      "o1",
      { getById: async () => detailWith("done"), db: { update: () => ({ set: setSpy }) } as never },
    );

    // 409, not 403: the caller IS permitted, the record's state is what
    // refuses — the same reasoning POST records for its cliente_deactivated.
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      errors: { form: "No se puede editar una orden completada o cancelada." },
    });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("refuses a CANCELLED order with the same 409 as a done one", async () => {
    const setSpy = vi.fn();

    const response = await handleUpdateOrdenServicio(
      requestWith({ observaciones: "Cliente notificado" }, "administrador"),
      "o1",
      { getById: async () => detailWith("cancelled"), db: { update: () => ({ set: setSpy }) } as never },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      errors: { form: "No se puede editar una orden completada o cancelada." },
    });
    expect(setSpy).not.toHaveBeenCalled();
  });

  /**
   * The ordering trap D11 exists to close: the status is read from the RECORD,
   * before the write, never from the body. A tab rendered while the order was
   * open will happily send its patch after someone else closed it.
   *
   * The body's claim is NOT a string on purpose. `typeof body.status ===
   * "string"` routes to `transitionOrder` and returns before the patch branch
   * is ever reached (route.ts:36), so a string claim can only be refused by
   * R21's state machine — see the companion case below. A non-string `status`
   * key is the only body that carries a status claim INTO the branch this gate
   * guards, and it is exactly what an unvalidated client can send.
   */
  it("reads the status from the record, not from a body claiming one", async () => {
    const setSpy = vi.fn();

    const response = await handleUpdateOrdenServicio(
      requestWith({ status: ["in_progress"], hallazgos: "Fuga de aceite" }, "administrador"),
      "o1",
      { getById: async () => detailWith("done"), db: { update: () => ({ set: setSpy }) } as never },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      errors: { form: "No se puede editar una orden completada o cancelada." },
    });
    expect(setSpy).not.toHaveBeenCalled();
  });

  /**
   * The other door on the same claim, pinned so a reader of the case above
   * knows both are shut: a STRING `status` never reaches this gate at all — it
   * is R21's `assertTransition` that refuses `done -> in_progress`, with a 400
   * and no write. The gate deliberately never sees a status change request.
   */
  it("leaves a string status claim to R21's state machine, which refuses it with 400 and no write", async () => {
    const setSpy = vi.fn();

    const response = await handleUpdateOrdenServicio(
      requestWith({ status: "in_progress", hallazgos: "Fuga de aceite" }, "administrador"),
      "o1",
      { getById: async () => detailWith("done"), db: { update: () => ({ set: setSpy }) } as never },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_transition", from: "done", to: "in_progress" });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("lets a tecnico patch an in_progress order, and the update receives the notes AS SENT", async () => {
    const setSpy = vi.fn(() => ({
      where: () => ({
        returning: async () => [
          { ...ordenWith("in_progress"), hallazgos: "Fuga de aceite", recomendaciones: "Cambiar empaque" },
        ],
      }),
    }));

    const response = await handleUpdateOrdenServicio(
      requestWith({ hallazgos: "Fuga de aceite", recomendaciones: "Cambiar empaque" }, "tecnico"),
      "o1",
      { getById: async () => detailWith("in_progress"), db: { update: () => ({ set: setSpy }) } as never },
    );

    expect(response.status).toBe(200);
    // What the seam RECEIVED — a route can answer 200 having written nothing.
    expect(setSpy).toHaveBeenCalledWith({ hallazgos: "Fuga de aceite", recomendaciones: "Cambiar empaque" });
    expect((await response.json()).orden.hallazgos).toBe("Fuga de aceite");
  });

  it("lets an administrador patch an OPEN order — the row the gate exists to keep open", async () => {
    const setSpy = vi.fn(() => ({
      where: () => ({ returning: async () => [{ ...ordenWith("open"), hallazgos: "Revisión inicial" }] }),
    }));

    const response = await handleUpdateOrdenServicio(
      requestWith({ hallazgos: "Revisión inicial" }, "administrador"),
      "o1",
      { getById: async () => detailWith("open"), db: { update: () => ({ set: setSpy }) } as never },
    );

    expect(response.status).toBe(200);
    expect(setSpy).toHaveBeenCalledWith({ hallazgos: "Revisión inicial" });
  });

  /**
   * The gate resolves the order itself, so it now owns the not-found answer on
   * the field-patch path (the status path's 404 comes from `transitionOrder`).
   * Task 4.7: confirm the new lookup did not turn a 404 into a 500 or a 403.
   */
  it("still answers 404 not_found for a missing order on the field-patch path", async () => {
    const setSpy = vi.fn();

    const response = await handleUpdateOrdenServicio(requestWith({ hallazgos: "Fuga de aceite" }), "missing", {
      getById: async () => null,
      db: { update: () => ({ set: setSpy }) } as never,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(setSpy).not.toHaveBeenCalled();
  });
});
