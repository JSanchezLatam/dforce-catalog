import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/modules/auth/roles";
import { handleContactVencimiento } from "./route";

function requestWith(body: unknown, role: Role = "administrador", raw?: string) {
  return new NextRequest("http://localhost/api/vencimientos/contact", {
    method: "POST",
    headers: { "x-user-id": "user-1", "x-user-role": role, "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

const valid = { vehiculoId: "veh-1", kind: "placa", periodKey: "2026-10" };

function deps(overrides: { exists?: boolean } = {}) {
  const insert = vi.fn(async () => undefined);
  return { insert, vehiculoExists: async () => overrides.exists ?? true };
}

describe("POST /api/vencimientos/contact", () => {
  it("refuses a tecnico with 403 and writes nothing", async () => {
    const d = deps();
    const response = await handleContactVencimiento(requestWith(valid, "tecnico"), d);
    expect(response.status).toBe(403);
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("answers 200 and records the mark with the session user for an administrador", async () => {
    const d = deps();
    const response = await handleContactVencimiento(requestWith(valid), d);
    expect(response.status).toBe(200);
    expect(d.insert).toHaveBeenCalledWith({ vehiculoId: "veh-1", kind: "placa", periodKey: "2026-10", contactedBy: "user-1" });
  });

  it("answers 200 again for a duplicate", async () => {
    const d = deps();
    expect((await handleContactVencimiento(requestWith(valid), d)).status).toBe(200);
    expect((await handleContactVencimiento(requestWith(valid), d)).status).toBe(200);
  });

  it("answers 400 with a Spanish message when the period key does not fit the kind", async () => {
    const d = deps();
    const response = await handleContactVencimiento(requestWith({ ...valid, kind: "seguro" }), d);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ errors: { periodKey: "El período no es válido para este tipo de vencimiento" } });
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("answers 400 for an unknown kind and for a body that is not JSON", async () => {
    const d = deps();
    expect((await handleContactVencimiento(requestWith({ ...valid, kind: "otro" }), d)).status).toBe(400);
    expect((await handleContactVencimiento(requestWith(null, "administrador", "{not json"), d)).status).toBe(400);
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("answers 404 for a vehicle that does not exist", async () => {
    const d = deps({ exists: false });
    const response = await handleContactVencimiento(requestWith(valid), d);
    expect(response.status).toBe(404);
    expect(d.insert).not.toHaveBeenCalled();
  });
});
