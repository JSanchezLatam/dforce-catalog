import { PgDialect } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/modules/auth/roles";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import type { OrdenServicio } from "@/shared/db/schema";
import { CorrectionRefusedError } from "@/modules/service-orders/correction-auth";
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
    kilometraje: null,
    nivelCombustible: null,
    bateriaPct: null,
    createdBy: null,
    createdAt: new Date("2026-05-01T14:00:00Z"),
    updatedAt: new Date("2026-05-01T14:00:00Z"),
  };
}

const current = { orden: ordenWith("open") };

/**
 * The transaction the service opens for a field patch: `select().from().where()
 * .for()` answers with the locked row (`null` = no such order), `update().set()`
 * is the caller's spy, `insert().values()` collects audit rows. Statuses come
 * from the ROW, never from a mock of `getById`.
 */
function lockedDb(
  status: OrderStatus | null,
  setSpy: (...args: never[]) => unknown = vi.fn(() => ({
    where: () => ({ returning: async () => [ordenWith(status ?? "open")] }),
  })),
) {
  const audit: Record<string, unknown>[] = [];
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: async () => (status ? [ordenWith(status)] : []) }) }) }),
    update: () => ({ set: setSpy }),
    insert: () => ({
      values: async (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        audit.push(...[rows].flat());
      },
    }),
  };
  return { db: { transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } as never, audit };
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
      db: lockedDb("open", vi.fn(() => ({ where: () => ({ returning: async () => [ordenWith("in_progress")] }) }))).db,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.orden.status).toBe("in_progress");
  });

  it("rejects an invalid transition with 400 (R21)", async () => {
    const response = await handleUpdateOrdenServicio(
      requestWith({ status: "done" }),
      "o1",
      { db: lockedDb("open").db },
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 for a missing order", async () => {
    const response = await handleUpdateOrdenServicio(requestWith({ status: "in_progress" }), "missing", {
      db: lockedDb(null).db,
    });
    expect(response.status).toBe(404);
  });

  it("updates plain fields (description/appointmentAt) without a status transition", async () => {
    const setSpy = vi.fn(() => ({
      where: () => ({ returning: async () => [{ ...current.orden, description: "Cambio de aceite" }] }),
    }));
    const response = await handleUpdateOrdenServicio(
      requestWith({ description: "Cambio de aceite" }),
      "o1",
      { db: lockedDb("open", setSpy).db },
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
      { db: lockedDb("open", setSpy).db },
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
        db: lockedDb("open", setSpy).db,
      },
    );

    expect(response.status).toBe(200);
    expect(setSpy).toHaveBeenCalledWith({ categoria: "revisado" });
  });
  it("rejects a categoria outside the enum with 400, without ever reaching the update", async () => {
    const setSpy = vi.fn();

    const response = await handleUpdateOrdenServicio(requestWith({ categoria: "banana" }), "o1", {
      db: lockedDb("open", setSpy).db,
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
        db: lockedDb("open", setSpy).db,
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
      db: lockedDb("open", setSpy).db,
    });

    expect(response.status).toBe(400);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("still accepts null on a note field — clearing one is not the same as smuggling an object", async () => {
    const setSpy = vi.fn(() => ({
      where: () => ({ returning: async () => [{ ...current.orden, hallazgos: null }] }),
    }));

    const response = await handleUpdateOrdenServicio(requestWith({ hallazgos: null }), "o1", {
      db: lockedDb("open", setSpy).db,
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
      db: lockedDb("open", setSpy).db,
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
      db: lockedDb("open", setSpy).db,
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
      db: lockedDb("open", setSpy).db,
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
      { db: lockedDb("open", setSpy).db },
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
      { db: lockedDb("done", setSpy).db },
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
      { db: lockedDb("cancelled", setSpy).db },
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
      { db: lockedDb("done", setSpy).db },
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
      { db: lockedDb("done", setSpy).db },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_transition", from: "done", to: "in_progress" });
    expect(setSpy).not.toHaveBeenCalled();
  });

  // Readiness is derived from the marks, never chosen: PATCH refuses it.
  it("refuses a PATCH status of ready_for_review with 400 and no write", async () => {
    const setSpy = vi.fn();

    const response = await handleUpdateOrdenServicio(
      requestWith({ status: "ready_for_review" }, "administrador"),
      "o1",
      { db: lockedDb("in_progress", setSpy).db },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_transition", from: "in_progress", to: "ready_for_review" });
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
      { db: lockedDb("in_progress", setSpy).db },
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
      { db: lockedDb("open", setSpy).db },
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
      db: lockedDb(null, setSpy).db,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(setSpy).not.toHaveBeenCalled();
  });
});

/**
 * service-order-reception — intake fields on the edit path. The D11 gate is
 * unchanged: it runs before the intake keys are even read.
 */
describe("PATCH /api/service-orders/[id] — intake fields", () => {
  const patchWith = (body: unknown, role: Role = "administrador", status: OrderStatus = "open") => {
    const setSpy = vi.fn(() => ({ where: () => ({ returning: async () => [ordenWith(status)] }) }));
    const response = handleUpdateOrdenServicio(requestWith(body, role), "o1", { db: lockedDb(status, setSpy).db });
    return { response, setSpy };
  };

  it("persists valid intake values, and an intake-only patch is not 'no changes'", async () => {
    const { response, setSpy } = patchWith({ kilometraje: 85000, nivelCombustible: 2, bateriaPct: 100 });

    expect((await response).status).toBe(200);
    expect(setSpy).toHaveBeenCalledWith({ kilometraje: 85000, nivelCombustible: 2, bateriaPct: 100 });
  });

  it("clears a field sent as null, and leaves an omitted one out of the SET", async () => {
    const { response, setSpy } = patchWith({ kilometraje: null });

    expect((await response).status).toBe(200);
    expect(setSpy).toHaveBeenCalledWith({ kilometraje: null });
  });

  it.each([
    [{ kilometraje: 1.5 }, "kilometraje"],
    [{ nivelCombustible: 5 }, "nivelCombustible"],
    [{ bateriaPct: 101 }, "bateriaPct"],
  ])("rejects %j with 400 and never reaches the update", async (intake, key) => {
    const { response, setSpy } = patchWith({ description: "x", ...intake });
    const res = await response;

    expect(res.status).toBe(400);
    expect(Object.keys((await res.json()).errors)).toEqual([key]);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("keeps the edit gate: a tecnico on an OPEN order is refused 403, a DONE order 409", async () => {
    const open = patchWith({ kilometraje: 100 }, "tecnico", "open");
    expect((await open.response).status).toBe(403);
    expect(open.setSpy).not.toHaveBeenCalled();

    const done = patchWith({ kilometraje: 100 }, "administrador", "done");
    expect((await done.response).status).toBe(409);
    expect(done.setSpy).not.toHaveBeenCalled();
  });
});

/**
 * closed-order-lock — the password travels with the save. The route verifies it
 * (`authorize`, injected: bcrypt is not what is under test here) BEFORE the
 * transaction and hands the service a grant; the service's lock decides.
 */
describe("PATCH /api/service-orders/[id] — closed-order correction", () => {
  const GRANT = { correctorId: "user-1" };

  function correct(
    body: Record<string, unknown>,
    role: Role,
    status: OrderStatus,
    authorize: (userId: string, password: string) => Promise<{ correctorId: string }> = vi.fn().mockResolvedValue(GRANT),
  ) {
    const setSpy = vi.fn(() => ({
      where: () => ({ returning: async () => [{ ...ordenWith(status), hallazgos: "nuevo" }] }),
    }));
    const { db, audit } = lockedDb(status, setSpy);
    const response = handleUpdateOrdenServicio(requestWith(body, role), "o1", { db, authorize });
    return { response, setSpy, audit, authorize };
  }

  it("refuses a tecnico who sends a password on a closed order with 403, never verifying it", async () => {
    const { response, setSpy, audit, authorize } = correct({ hallazgos: "nuevo", password: "pw" }, "tecnico", "done");

    expect((await response).status).toBe(403);
    expect(authorize).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(audit).toEqual([]);
  });

  it("answers an administrator with no password on a closed order 409, without verifying anything", async () => {
    const { response, setSpy, audit, authorize } = correct({ hallazgos: "nuevo" }, "administrador", "done");

    const res = await response;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ errors: { form: "No se puede editar una orden completada o cancelada." } });
    expect(authorize).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(audit).toEqual([]);
  });

  it("answers a wrong password 403 wrong_password, writing nothing", async () => {
    const authorize = vi.fn().mockRejectedValue(new CorrectionRefusedError("wrong_password"));
    const { response, setSpy, audit } = correct({ hallazgos: "nuevo", password: "mal" }, "administrador", "done", authorize);

    const res = await response;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "wrong_password", message: "Contraseña incorrecta" });
    expect(setSpy).not.toHaveBeenCalled();
    expect(audit).toEqual([]);
  });

  it("answers a throttled attempt 429 with Retry-After, writing nothing", async () => {
    const authorize = vi.fn().mockRejectedValue(new CorrectionRefusedError("throttled"));
    const { response, setSpy, audit } = correct({ hallazgos: "nuevo", password: "pw" }, "administrador", "done", authorize);

    const res = await response;
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("900");
    expect(await res.json()).toEqual({
      error: "throttled",
      message: "Demasiados intentos. Probá de nuevo en 15 minutos.",
    });
    expect(setSpy).not.toHaveBeenCalled();
    expect(audit).toEqual([]);
  });

  it("answers an authorizer refusal for a non-administrator 403, writing nothing", async () => {
    const authorize = vi.fn().mockRejectedValue(new CorrectionRefusedError("not_admin"));
    const { response, setSpy } = correct({ hallazgos: "nuevo", password: "pw" }, "administrador", "done", authorize);

    expect((await response).status).toBe(403);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("accepts a correct password on a closed order: 200, the field written, one audit row, password not stored", async () => {
    const { response, setSpy, audit, authorize } = correct({ hallazgos: "nuevo", password: "pw" }, "administrador", "cancelled");

    expect((await response).status).toBe(200);
    expect(authorize).toHaveBeenCalledWith("user-1", "pw");
    // The password is not a column: it must never reach `.set()`.
    expect(setSpy).toHaveBeenCalledWith({ hallazgos: "nuevo" });
    expect(audit).toEqual([
      { ordenId: "o1", userId: "user-1", field: "hallazgos", oldValue: null, newValue: "nuevo" },
    ]);
  });

  it("ignores a password on an open order: the edit goes through and writes no audit row", async () => {
    const { response, setSpy, audit } = correct({ hallazgos: "nuevo", password: "pw" }, "administrador", "open");

    expect((await response).status).toBe(200);
    expect(setSpy).toHaveBeenCalledWith({ hallazgos: "nuevo" });
    expect(audit).toEqual([]);
  });

  it("refuses a tecnico with no password on a closed order with 403, not the administrator's 409", async () => {
    const { response, setSpy, audit, authorize } = correct({ hallazgos: "nuevo" }, "tecnico", "done");

    const res = await response;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ errors: { form: "Solo un administrador puede corregir una orden cerrada." } });
    expect(authorize).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(audit).toEqual([]);
  });

  it("never verifies a password sent with an open-order edit, so a wrong one neither refuses nor counts", async () => {
    const authorize = vi.fn().mockRejectedValue(new CorrectionRefusedError("wrong_password"));
    const { response, setSpy, audit } = correct({ hallazgos: "nuevo", password: "mal" }, "administrador", "open", authorize);

    expect((await response).status).toBe(200);
    expect(authorize).not.toHaveBeenCalled();
    expect(setSpy).toHaveBeenCalledWith({ hallazgos: "nuevo" });
    expect(audit).toEqual([]);
  });

  it("does not spend a password check on a body that fails validation", async () => {
    const { response, authorize } = correct({ hallazgos: { evil: 1 }, password: "pw" }, "administrador", "done");

    expect((await response).status).toBe(400);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("never writes status or completedAt on a correction, whatever the body claims", async () => {
    const { response, setSpy } = correct(
      { hallazgos: "nuevo", password: "pw", status: ["open"], completedAt: "2020-01-01T00:00:00.000Z" },
      "administrador",
      "done",
    );

    expect((await response).status).toBe(200);
    expect(setSpy).toHaveBeenCalledWith({ hallazgos: "nuevo" });
  });
});

describe("PATCH /api/service-orders/[id] — who may transition (R21)", () => {
  const transition = (to: OrderStatus, from: OrderStatus, role: Role) => {
    const setSpy = vi.fn(() => ({ where: () => ({ returning: async () => [ordenWith(to)] }) }));
    return {
      setSpy,
      run: () =>
        handleUpdateOrdenServicio(requestWith({ status: to }, role), "o1", {
          db: lockedDb(from, setSpy).db,
          getClienteById: async () => null,
          cancelRemindersForOrder: async () => {},
        }),
    };
  };

  it("lets a tecnico start work: open -> in_progress answers 200", async () => {
    const { run } = transition("in_progress", "open", "tecnico");
    expect((await run()).status).toBe(200);
  });

  it.each(["done", "cancelled"] as const)("refuses a tecnico closing an in_progress order as %s with 403 and no write", async (to) => {
    const { run, setSpy } = transition(to, "in_progress", "tecnico");
    const response = await run();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "forbidden",
      message: "Solo un administrador o el jefe de taller puede cerrar, cancelar o devolver una orden.",
    });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("refuses a tecnico returning a ready_for_review order to in_progress with 403 and no write", async () => {
    const { run, setSpy } = transition("in_progress", "ready_for_review", "tecnico");
    expect((await run()).status).toBe(403);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["in_progress", "done"],
    ["ready_for_review", "done"],
    ["ready_for_review", "cancelled"],
    ["ready_for_review", "in_progress"],
  ] as const)("lets a jefe_taller do %s -> %s", async (from, to) => {
    const { run } = transition(to, from, "jefe_taller");
    expect((await run()).status).toBe(200);
  });

  it("lets an administrador return a ready_for_review order to in_progress", async () => {
    const { run } = transition("in_progress", "ready_for_review", "administrador");
    expect((await run()).status).toBe(200);
  });

  it("scopes the lock to the caller: a tecnico's SELECT ... FOR UPDATE carries the assignment condition", async () => {
    const wheres: unknown[] = [];
    const tx = {
      select: () => ({
        from: () => ({
          where: (condition: unknown) => {
            wheres.push(condition);
            return { for: async () => [] };
          },
        }),
      }),
    };
    const response = await handleUpdateOrdenServicio(requestWith({ status: "in_progress" }, "tecnico"), "o1", {
      db: { transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } as never,
    });

    // an unassigned order is a 404, never a 403 that would confirm it exists
    expect(response.status).toBe(404);
    expect(new PgDialect().sqlToQuery(wheres[0] as never).sql).toContain('"orden_tecnico"."orden_id" = "orden_servicio"."id"');
  });

  it("scopes a field patch the same way", async () => {
    const wheres: unknown[] = [];
    const tx = {
      select: () => ({
        from: () => ({
          where: (condition: unknown) => {
            wheres.push(condition);
            return { for: async () => [] };
          },
        }),
      }),
    };
    const response = await handleUpdateOrdenServicio(requestWith({ hallazgos: "x" }, "tecnico"), "o1", {
      db: { transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } as never,
    });

    expect(response.status).toBe(404);
    expect(new PgDialect().sqlToQuery(wheres[0] as never).sql).toContain('"orden_tecnico"');
  });

  it("gives an administrador no scope condition", async () => {
    const wheres: unknown[] = [];
    const tx = {
      select: () => ({
        from: () => ({
          where: (condition: unknown) => {
            wheres.push(condition);
            return { for: async () => [] };
          },
        }),
      }),
    };
    await handleUpdateOrdenServicio(requestWith({ status: "in_progress" }, "administrador"), "o1", {
      db: { transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } as never,
    });
    expect(new PgDialect().sqlToQuery(wheres[0] as never).sql).not.toContain("orden_tecnico");
  });
});
