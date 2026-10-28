import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/modules/auth/roles";
import { OrderClosedError } from "@/modules/service-orders/order-lock";
import { OrdenServicioNotFoundError } from "@/modules/service-orders/service";
import { DELETE, handleClear, handleSet, POST } from "./route";

function req(method: "POST" | "DELETE", role: Role = "jefe_taller") {
  return new NextRequest("http://localhost/api/service-orders/o1/urgent", {
    method,
    headers: { "x-user-id": "user-1", "x-user-role": role },
  });
}

describe("urgent route", () => {
  it("throws without session headers", async () => {
    const request = new NextRequest("http://localhost/api/service-orders/o1/urgent", { method: "POST" });
    await expect(POST(request, { params: Promise.resolve({ id: "o1" }) })).rejects.toThrow();
    await expect(DELETE(request, { params: Promise.resolve({ id: "o1" }) })).rejects.toThrow();
  });

  it.each(["administrador", "jefe_taller"] as const)("POST as %s: 200, sets with the session user and scope", async (role) => {
    const set = vi.fn().mockResolvedValue({ urgent: true });
    const res = await handleSet(req("POST", role), "o1", { set });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ urgent: true });
    expect(set).toHaveBeenCalledWith("o1", true, expect.objectContaining({ actorId: "user-1", scope: expect.any(Object) }));
  });

  it("DELETE: 200, clears", async () => {
    const set = vi.fn().mockResolvedValue({ urgent: false });
    const res = await handleClear(req("DELETE"), "o1", { set });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ urgent: false });
    expect(set).toHaveBeenCalledWith("o1", false, expect.objectContaining({ actorId: "user-1" }));
  });

  it.each(["tecnico", "pantalla"] as const)("403 for %s on both verbs, calling nothing", async (role) => {
    const set = vi.fn();
    expect((await handleSet(req("POST", role), "o1", { set })).status).toBe(403);
    expect((await handleClear(req("DELETE", role), "o1", { set })).status).toBe(403);
    expect(set).not.toHaveBeenCalled();
  });

  it("404 for an order the scope cannot see", async () => {
    const set = vi.fn().mockRejectedValue(new OrdenServicioNotFoundError("o1"));
    expect((await handleSet(req("POST"), "o1", { set })).status).toBe(404);
  });

  it("409 for a closed order, with a Spanish message", async () => {
    const set = vi.fn().mockRejectedValue(new OrderClosedError());
    const res = await handleSet(req("POST"), "o1", { set });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "order_closed", message: "La orden está cerrada y ya no se puede cambiar si es urgente." });
  });

  it("rethrows an error it does not know", async () => {
    const set = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(handleSet(req("POST"), "o1", { set })).rejects.toThrow("boom");
  });
});
