import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/modules/auth/roles";
import { InvalidTecnicoError } from "@/modules/service-orders/assignments";
import { OrderClosedError } from "@/modules/service-orders/order-lock";
import { OrdenServicioNotFoundError } from "@/modules/service-orders/service";
import { handleAssign, POST } from "./route";

function req(body: unknown, role: Role = "jefe_taller", raw?: string) {
  return new NextRequest("http://localhost/api/service-orders/o1/assignments", {
    method: "POST",
    headers: { "x-user-id": "user-1", "x-user-role": role, "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

describe("POST /api/service-orders/[id]/assignments", () => {
  it("throws when called without session headers", async () => {
    const request = new NextRequest("http://localhost/api/service-orders/o1/assignments", { method: "POST", body: "{}" });
    await expect(POST(request, { params: Promise.resolve({ id: "o1" }) })).rejects.toThrow();
  });

  it("refuses a técnico with 403 before reading the order", async () => {
    const assign = vi.fn();
    const res = await handleAssign(req({ tecnicoId: "t1" }, "tecnico"), "o1", { assign });
    expect(res.status).toBe(403);
    expect(assign).not.toHaveBeenCalled();
  });

  it.each(["jefe_taller", "administrador"] as const)("201 when %s assigns a new technician, stamped with the SESSION user", async (role) => {
    const assign = vi.fn().mockResolvedValue({ created: true });
    const res = await handleAssign(req({ tecnicoId: "t1" }, role), "o1", { assign });

    expect(res.status).toBe(201);
    expect(assign).toHaveBeenCalledWith({
      ordenId: "o1",
      tecnicoId: "t1",
      assignedBy: "user-1",
      scope: { where: undefined },
    });
  });

  it("200 for a technician already assigned: a no-op, not an error", async () => {
    const assign = vi.fn().mockResolvedValue({ created: false });
    const res = await handleAssign(req({ tecnicoId: "t1" }), "o1", { assign });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: false });
  });

  it.each([[{}], [{ tecnicoId: "" }], [{ tecnicoId: 7 }], [{ tecnicoId: ["t1"] }], [null]])(
    "400 for the body %j, without calling the service",
    async (body) => {
      const assign = vi.fn();
      const res = await handleAssign(req(body), "o1", { assign });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ errors: { tecnicoId: "Elegí un técnico" } });
      expect(assign).not.toHaveBeenCalled();
    },
  );

  it("400 for a malformed JSON body rather than a 500", async () => {
    const assign = vi.fn();
    const res = await handleAssign(req(undefined, "jefe_taller", "{nope"), "o1", { assign });
    expect(res.status).toBe(400);
  });

  it("404 for an order that does not exist", async () => {
    const assign = vi.fn().mockRejectedValue(new OrdenServicioNotFoundError("o1"));
    expect((await handleAssign(req({ tecnicoId: "t1" }), "o1", { assign })).status).toBe(404);
  });

  it("409 for a closed order, whoever asks and whatever password rides along: never correctable", async () => {
    const assign = vi.fn().mockRejectedValue(new OrderClosedError());
    const res = await handleAssign(req({ tecnicoId: "t1", password: "pw" }, "administrador"), "o1", { assign });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "order_closed",
      message: "No se puede asignar un técnico a una orden completada o cancelada.",
    });
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign.mock.calls[0][0]).not.toHaveProperty("correction");
  });

  it("400 under errors.tecnicoId for a deactivated or unknown technician", async () => {
    const assign = vi.fn().mockRejectedValue(new InvalidTecnicoError({ tecnicoIds: "Elegí técnicos activos" }));
    const res = await handleAssign(req({ tecnicoId: "t1" }), "o1", { assign });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: { tecnicoId: "Elegí un técnico activo" } });
  });
});
