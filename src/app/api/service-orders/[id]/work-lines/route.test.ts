import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/modules/auth/roles";
import { CorrectionRefusedError } from "@/modules/service-orders/correction-auth";
import { OrderClosedError, OrderEditForbiddenError } from "@/modules/service-orders/order-lock";
import { OrdenServicioNotFoundError } from "@/modules/service-orders/service";
import { WorkLineForbiddenError, WorkLineRefusedError, WorkLineValidationError } from "@/modules/service-orders/work-lines";
import { handleAddWorkLine, POST } from "./route";

function req(body: unknown, role: Role = "administrador", raw?: string) {
  return new NextRequest("http://localhost/api/service-orders/o1/work-lines", {
    method: "POST",
    headers: { "x-user-id": "user-1", "x-user-role": role, "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}
const line = { tecnicoId: "t1", descripcion: "Cambio de pastillas", duracionMinutos: 90, fecha: "2026-10-05" };

describe("POST /api/service-orders/[id]/work-lines", () => {
  it("throws when called without session headers", async () => {
    const request = new NextRequest("http://localhost/api/service-orders/o1/work-lines", { method: "POST", body: "{}" });
    await expect(POST(request, { params: Promise.resolve({ id: "o1" }) })).rejects.toThrow();
  });

  it("201 with {id}; hands the service the session user, the role flag and the scope", async () => {
    const add = vi.fn().mockResolvedValue({ id: "l1" });
    const res = await handleAddWorkLine(req(line, "jefe_taller"), "o1", { add });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "l1" });
    expect(add).toHaveBeenCalledWith({
      ordenId: "o1",
      ...line,
      actor: { id: "user-1", canManageAll: true },
      scope: { where: undefined },
    });
  });

  it("a técnico is not staff and gets a scope with the assignment condition", async () => {
    const add = vi.fn().mockResolvedValue({ id: "l1" });
    await handleAddWorkLine(req(line, "tecnico"), "o1", { add });

    expect(add.mock.calls[0][0].actor).toEqual({ id: "user-1", canManageAll: false });
    expect(add.mock.calls[0][0].scope.where).toBeDefined();
  });

  it("400 for an unreadable body and for a missing technician, calling nothing", async () => {
    const add = vi.fn();
    expect((await handleAddWorkLine(req(null, "administrador", "{nope"), "o1", { add })).status).toBe(400);
    const res = await handleAddWorkLine(req({ ...line, tecnicoId: "" }), "o1", { add });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: { tecnicoId: "Elegí un técnico" } });
    expect(add).not.toHaveBeenCalled();
  });

  it("400 with the service's Spanish field errors", async () => {
    const add = vi.fn().mockRejectedValue(new WorkLineValidationError({ duracionMinutos: "Los minutos tienen que ser un entero entre 1 y 1440" }));
    const res = await handleAddWorkLine(req({ ...line, duracionMinutos: 0 }), "o1", { add });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: { duracionMinutos: "Los minutos tienen que ser un entero entre 1 y 1440" } });
  });

  it("404 for an order the scope cannot see (an unassigned técnico)", async () => {
    const add = vi.fn().mockRejectedValue(new OrdenServicioNotFoundError("o1"));
    expect((await handleAddWorkLine(req(line, "tecnico"), "o1", { add })).status).toBe(404);
  });

  it("403 for a técnico naming someone else; 409 for a marked técnico and for a status that takes no lines", async () => {
    const run = (err: Error) => handleAddWorkLine(req(line, "tecnico"), "o1", { add: vi.fn().mockRejectedValue(err) });
    expect((await run(new WorkLineForbiddenError())).status).toBe(403);
    expect((await run(new WorkLineRefusedError())).status).toBe(409);
    const open = await run(new OrderEditForbiddenError());
    expect(open.status).toBe(409);
    expect((await open.json()).message).toBe("La orden no admite líneas de trabajo en este estado.");
  });

  describe("a closed order", () => {
    it.each(["jefe_taller", "tecnico"] as const)("%s gets 403 and a password is never verified", async (role) => {
      const add = vi.fn().mockRejectedValue(new OrderClosedError());
      const authorize = vi.fn();
      const res = await handleAddWorkLine(req({ ...line, password: "hunter2" }, role), "o1", { add, authorize });

      expect(res.status).toBe(403);
      expect(authorize).not.toHaveBeenCalled();
      expect(add).toHaveBeenCalledTimes(1);
    });

    it("an administrador with no password gets 409", async () => {
      const add = vi.fn().mockRejectedValue(new OrderClosedError());
      const authorize = vi.fn();
      const res = await handleAddWorkLine(req(line), "o1", { add, authorize });

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "order_closed" });
      expect(authorize).not.toHaveBeenCalled();
    });

    it("an administrador with the password retries with the grant, and the password never reaches the service", async () => {
      const add = vi.fn().mockRejectedValueOnce(new OrderClosedError()).mockResolvedValueOnce({ id: "l1" });
      const authorize = vi.fn().mockResolvedValue({ correctorId: "user-1" });
      const res = await handleAddWorkLine(req({ ...line, password: "pw" }), "o1", { add, authorize });

      expect(res.status).toBe(201);
      expect(authorize).toHaveBeenCalledWith("user-1", "pw");
      expect(add.mock.calls[1][0].correction).toEqual({ correctorId: "user-1" });
      expect(JSON.stringify(add.mock.calls)).not.toContain("pw");
    });

    it("a wrong password is 403", async () => {
      const add = vi.fn().mockRejectedValue(new OrderClosedError());
      const authorize = vi.fn().mockRejectedValue(new CorrectionRefusedError("wrong_password"));
      const res = await handleAddWorkLine(req({ ...line, password: "bad" }), "o1", { add, authorize });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "wrong_password", message: "Contraseña incorrecta" });
    });

    it("an open order never verifies a password that was sent", async () => {
      const add = vi.fn().mockResolvedValue({ id: "l1" });
      const authorize = vi.fn();
      await handleAddWorkLine(req({ ...line, password: "pw" }), "o1", { add, authorize });
      expect(authorize).not.toHaveBeenCalled();
    });
  });
});
