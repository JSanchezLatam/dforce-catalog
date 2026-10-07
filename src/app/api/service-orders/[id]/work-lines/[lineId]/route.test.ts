import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/modules/auth/roles";
import { CorrectionRefusedError } from "@/modules/service-orders/correction-auth";
import { OrderClosedError } from "@/modules/service-orders/order-lock";
import { OrdenServicioNotFoundError } from "@/modules/service-orders/service";
import { WorkLineForbiddenError, WorkLineNotFoundError, WorkLineValidationError } from "@/modules/service-orders/work-lines";
import { DELETE, handleDeleteWorkLine, handleUpdateWorkLine, PATCH } from "./route";

const ids = { ordenId: "o1", lineId: "l1" };
function req(method: "PATCH" | "DELETE", body: unknown, role: Role = "administrador", raw?: string) {
  return new NextRequest("http://localhost/api/service-orders/o1/work-lines/l1", {
    method,
    headers: { "x-user-id": "user-1", "x-user-role": role, "Content-Type": "application/json" },
    ...(body === undefined && raw === undefined ? {} : { body: raw ?? JSON.stringify(body) }),
  });
}
const context = { params: Promise.resolve({ id: "o1", lineId: "l1" }) };

describe("PATCH /api/service-orders/[id]/work-lines/[lineId]", () => {
  it("throws without session headers", async () => {
    const request = new NextRequest("http://localhost/x", { method: "PATCH", body: "{}" });
    await expect(PATCH(request, context)).rejects.toThrow();
  });

  it("200; passes ONLY description, minutes and date: a technician or order in the body is dropped, and so is the password", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const res = await handleUpdateWorkLine(
      req("PATCH", { duracionMinutos: 45, tecnicoId: "t-other", ordenId: "o-other", password: "pw" }, "jefe_taller"),
      ids,
      { update },
    );

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      ...ids,
      patch: { descripcion: undefined, duracionMinutos: 45, fecha: undefined },
      actor: { id: "user-1", canManageAll: true },
      scope: { where: undefined },
    });
  });

  it("400 for an unreadable body and with the service's Spanish errors", async () => {
    const update = vi.fn().mockRejectedValue(new WorkLineValidationError({ fecha: "La fecha no es válida" }));
    expect((await handleUpdateWorkLine(req("PATCH", null, "administrador", "{nope"), ids, { update })).status).toBe(400);
    const res = await handleUpdateWorkLine(req("PATCH", { fecha: "x" }), ids, { update });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: { fecha: "La fecha no es válida" } });
  });

  it("404 for an unassigned técnico's order and for a line that is not on it; 403 for someone else's line", async () => {
    const run = (err: Error) => handleUpdateWorkLine(req("PATCH", { fecha: "2026-10-05" }, "tecnico"), ids, { update: vi.fn().mockRejectedValue(err) });
    expect((await run(new OrdenServicioNotFoundError("o1"))).status).toBe(404);
    expect((await run(new WorkLineNotFoundError())).status).toBe(404);
    expect((await run(new WorkLineForbiddenError())).status).toBe(403);
  });

  it("a jefe on a closed order is 403 and no password is verified; an administrador with one is corrected", async () => {
    const authorize = vi.fn().mockResolvedValue({ correctorId: "user-1" });
    const closed = () => vi.fn().mockRejectedValueOnce(new OrderClosedError()).mockResolvedValue(undefined);

    const jefe = await handleUpdateWorkLine(req("PATCH", { fecha: "2026-10-05", password: "pw" }, "jefe_taller"), ids, { update: closed(), authorize });
    expect(jefe.status).toBe(403);
    expect(authorize).not.toHaveBeenCalled();

    const update = closed();
    const admin = await handleUpdateWorkLine(req("PATCH", { fecha: "2026-10-05", password: "pw" }), ids, { update, authorize });
    expect(admin.status).toBe(200);
    expect(update.mock.calls[1][0].correction).toEqual({ correctorId: "user-1" });
  });

  it("no password is 409; a wrong one is 403", async () => {
    const update = vi.fn().mockRejectedValue(new OrderClosedError());
    expect((await handleUpdateWorkLine(req("PATCH", { fecha: "2026-10-05" }), ids, { update })).status).toBe(409);
    const authorize = vi.fn().mockRejectedValue(new CorrectionRefusedError("wrong_password"));
    expect((await handleUpdateWorkLine(req("PATCH", { fecha: "2026-10-05", password: "bad" }), ids, { update, authorize })).status).toBe(403);
  });
});

describe("DELETE /api/service-orders/[id]/work-lines/[lineId]", () => {
  it("throws without session headers", async () => {
    const request = new NextRequest("http://localhost/x", { method: "DELETE" });
    await expect(DELETE(request, context)).rejects.toThrow();
  });

  it("200 with no body at all (the client may send none)", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const res = await handleDeleteWorkLine(req("DELETE", undefined, "tecnico"), ids, { remove });

    expect(res.status).toBe(200);
    expect(remove.mock.calls[0][0]).toMatchObject({ ...ids, actor: { id: "user-1", canManageAll: false } });
    expect(remove.mock.calls[0][0].scope.where).toBeDefined();
  });

  it("404 / 403 mapping, and a jefe on a closed order is 403 without verifying the password", async () => {
    const run = (err: Error, role: Role = "tecnico") =>
      handleDeleteWorkLine(req("DELETE", { password: "pw" }, role), ids, { remove: vi.fn().mockRejectedValue(err), authorize: vi.fn() });
    expect((await run(new OrdenServicioNotFoundError("o1"))).status).toBe(404);
    expect((await run(new WorkLineNotFoundError())).status).toBe(404);
    expect((await run(new WorkLineForbiddenError())).status).toBe(403);
    expect((await run(new OrderClosedError(), "jefe_taller")).status).toBe(403);
  });

  it("an administrador deletes from a closed order with the password", async () => {
    const remove = vi.fn().mockRejectedValueOnce(new OrderClosedError()).mockResolvedValue(undefined);
    const authorize = vi.fn().mockResolvedValue({ correctorId: "user-1" });
    const res = await handleDeleteWorkLine(req("DELETE", { password: "pw" }), ids, { remove, authorize });

    expect(res.status).toBe(200);
    expect(authorize).toHaveBeenCalledWith("user-1", "pw");
    expect(remove.mock.calls[1][0].correction).toEqual({ correctorId: "user-1" });
  });
});
