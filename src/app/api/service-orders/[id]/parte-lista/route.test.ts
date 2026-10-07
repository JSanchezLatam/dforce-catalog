import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/modules/auth/roles";
import { OrderClosedError, OrderEditForbiddenError } from "@/modules/service-orders/order-lock";
import { ParteListaForbiddenError, ParteListaRefusedError } from "@/modules/service-orders/parte-lista";
import { OrdenServicioNotFoundError } from "@/modules/service-orders/service";
import { DELETE, handleMark, handleUnmark, POST } from "./route";

function req(method: "POST" | "DELETE", role: Role = "tecnico", body?: unknown, raw?: string) {
  return new NextRequest("http://localhost/api/service-orders/o1/parte-lista", {
    method,
    headers: { "x-user-id": "user-1", "x-user-role": role, "Content-Type": "application/json" },
    ...(body !== undefined || raw !== undefined ? { body: raw ?? JSON.stringify(body) } : {}),
  });
}

describe("POST /api/service-orders/[id]/parte-lista", () => {
  it("throws when called without session headers", async () => {
    const request = new NextRequest("http://localhost/api/service-orders/o1/parte-lista", { method: "POST" });
    await expect(POST(request, { params: Promise.resolve({ id: "o1" }) })).rejects.toThrow();
  });

  it("200 with the resulting status; hands the service the session user and the caller's scope", async () => {
    const mark = vi.fn().mockResolvedValue({ status: "ready_for_review" });
    const res = await handleMark(req("POST"), "o1", { mark });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready_for_review" });
    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark.mock.calls[0][0]).toMatchObject({ ordenId: "o1", userId: "user-1" });
    expect(mark.mock.calls[0][0].scope.where).toBeDefined(); // a técnico's scope carries the assignment condition
  });

  it("passes a named tecnicoId through so the service can refuse it, and works with no body at all", async () => {
    const mark = vi.fn().mockResolvedValue({ status: "in_progress" });
    await handleMark(req("POST", "tecnico", { tecnicoId: "t2" }), "o1", { mark });
    await handleMark(req("POST"), "o1", { mark });

    expect(mark.mock.calls[0][0].tecnicoId).toBe("t2");
    expect(mark.mock.calls[1][0].tecnicoId).toBeUndefined();
  });

  it("an unreadable body means no named technician, not a 500", async () => {
    const mark = vi.fn().mockResolvedValue({ status: "in_progress" });
    expect((await handleMark(req("POST", "tecnico", undefined, "{nope"), "o1", { mark })).status).toBe(200);
    expect(mark.mock.calls[0][0].tecnicoId).toBeUndefined();
  });

  it("403 naming the other technician's part", async () => {
    const mark = vi.fn().mockRejectedValue(new ParteListaForbiddenError());
    const res = await handleMark(req("POST", "tecnico", { tecnicoId: "t2" }), "o1", { mark });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", message: "Solo podés marcar tu propia parte" });
  });

  it("404 for an order the scope cannot see", async () => {
    const mark = vi.fn().mockRejectedValue(new OrdenServicioNotFoundError("o1"));
    expect((await handleMark(req("POST"), "o1", { mark })).status).toBe(404);
  });

  it("409 for an already-marked part", async () => {
    const mark = vi.fn().mockRejectedValue(new ParteListaRefusedError("Tu parte ya está marcada como lista"));
    const res = await handleMark(req("POST"), "o1", { mark });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "parte_lista", message: "Tu parte ya está marcada como lista" });
  });

  it("409 for a status that takes no mark, with a Spanish message", async () => {
    const mark = vi.fn().mockRejectedValue(new OrderEditForbiddenError());
    const res = await handleMark(req("POST"), "o1", { mark });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe("La orden no admite cambios en tu parte en este estado.");
  });

  it.each(["tecnico", "jefe_taller", "administrador"] as const)(
    "a closed order is refused with 409 for %s, and no password is ever read",
    async (role) => {
      const mark = vi.fn().mockRejectedValue(new OrderClosedError());
      const res = await handleMark(req("POST", role, { password: "hunter2" }), "o1", { mark });

      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("order_closed");
      expect(mark).toHaveBeenCalledTimes(1); // never retried with a grant
      expect(mark.mock.calls[0][0]).not.toHaveProperty("correction");
    },
  );

  it("403 before any lookup for a role the matrix does not know", async () => {
    const mark = vi.fn();
    expect((await handleMark(req("POST", "intruso" as Role), "o1", { mark })).status).toBe(403);
    expect(mark).not.toHaveBeenCalled();
  });

  it("rethrows an error it does not know", async () => {
    const mark = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(handleMark(req("POST"), "o1", { mark })).rejects.toThrow("boom");
  });
});

describe("DELETE /api/service-orders/[id]/parte-lista", () => {
  it("200 with the resulting status when un-marking", async () => {
    const unmark = vi.fn().mockResolvedValue({ status: "in_progress" });
    const res = await handleUnmark(req("DELETE"), "o1", { unmark });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "in_progress" });
    expect(unmark.mock.calls[0][0]).toMatchObject({ ordenId: "o1", userId: "user-1" });
  });

  it("maps the same refusals: 403, 404, 409", async () => {
    const run = (err: Error) => handleUnmark(req("DELETE"), "o1", { unmark: vi.fn().mockRejectedValue(err) });
    expect((await run(new ParteListaForbiddenError())).status).toBe(403);
    expect((await run(new OrdenServicioNotFoundError("o1"))).status).toBe(404);
    expect((await run(new ParteListaRefusedError("Tu parte no está marcada como lista"))).status).toBe(409);
    expect((await run(new OrderClosedError())).status).toBe(409);
  });

  it("exports a DELETE that needs a session", async () => {
    const request = new NextRequest("http://localhost/api/service-orders/o1/parte-lista", { method: "DELETE" });
    await expect(DELETE(request, { params: Promise.resolve({ id: "o1" }) })).rejects.toThrow();
  });
});
