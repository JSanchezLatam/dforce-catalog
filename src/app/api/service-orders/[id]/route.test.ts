import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { OrdenServicio } from "@/shared/db/schema";
import { handleUpdateOrdenServicio, PATCH } from "./route";

function requestWith(body: unknown) {
  return new NextRequest("http://localhost/api/service-orders/o1", {
    method: "PATCH",
    headers: { "x-user-id": "user-1", "x-user-role": "tecnico", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const current = {
  orden: { id: "o1", status: "open", clienteId: "cli-1", appointmentAt: null } as unknown as OrdenServicio,
  items: [],
};

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
